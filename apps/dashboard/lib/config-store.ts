import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { deleteSettingsByPrefix, getAllSettings, upsertSetting } from '@/lib/db/queries'
import {
	type RecalboxRow,
	deleteRecalbox,
	getDefaultRecalbox,
	getRecalbox,
	insertRecalbox,
	listRecalboxes,
	rowToInstance,
	setDefaultRecalbox,
	updateRecalbox,
} from '@/lib/db/recalbox-queries'
import { getDefaults } from '@/lib/settings/defaults'
import {
	type AppConfig,
	type DeepPartial,
	type RecalboxInstance,
	SETUP_COMPLETED_KEY,
} from '@/lib/settings/schemas'

const SINGLETON_VERSION = 2

function flattenConfig(cfg: AppConfig): Record<string, string> {
	const flat: Record<string, string> = {}
	for (const [scope, values] of Object.entries(cfg)) {
		if (scope === 'recalbox') continue
		for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
			flat[`${scope}.${key}`] = String(value)
		}
	}
	return flat
}

function mergeDbIntoDefaults(defaults: AppConfig, dbRows: Record<string, string>): AppConfig {
	const result = structuredClone(defaults) as AppConfig & Record<string, Record<string, unknown>>
	for (const [flatKey, rawValue] of Object.entries(dbRows)) {
		if (flatKey.startsWith('__') || flatKey.startsWith('recalbox.')) continue
		const dotIdx = flatKey.indexOf('.')
		if (dotIdx === -1) continue
		const scope = flatKey.slice(0, dotIdx) as keyof AppConfig
		const key = flatKey.slice(dotIdx + 1)
		if (!result[scope]) continue
		const current = (result[scope] as Record<string, unknown>)[key]
		if (typeof current === 'number') {
			;(result[scope] as Record<string, unknown>)[key] = Number(rawValue)
		} else if (typeof current === 'boolean') {
			;(result[scope] as Record<string, unknown>)[key] = rawValue === 'true'
		} else {
			;(result[scope] as Record<string, unknown>)[key] = rawValue
		}
	}
	return result as AppConfig
}

function deepMerge<T extends object>(target: T, partial: DeepPartial<T>): T {
	const result = structuredClone(target)
	for (const key of Object.keys(partial) as (keyof T)[]) {
		const pVal = (partial as Record<keyof T, unknown>)[key]
		if (pVal === undefined) continue
		const tVal = (target as Record<keyof T, unknown>)[key]
		if (tVal !== null && typeof tVal === 'object' && typeof pVal === 'object') {
			;(result as Record<keyof T, unknown>)[key] = deepMerge(
				tVal as object,
				pVal as DeepPartial<object>,
			) as T[keyof T]
		} else {
			;(result as Record<keyof T, unknown>)[key] = pVal as T[keyof T]
		}
	}
	return result
}

function changedScopes(prev: AppConfig, next: AppConfig): (keyof AppConfig)[] {
	const scopes: (keyof AppConfig)[] = []
	for (const scope of Object.keys(prev) as (keyof AppConfig)[]) {
		if (JSON.stringify(prev[scope]) !== JSON.stringify(next[scope])) scopes.push(scope)
	}
	return scopes
}

interface ConfigStoreEvents {
	changed: (config: AppConfig) => void
	'changed:recalbox': (config: AppConfig) => void
	'changed:scrobble': (config: AppConfig) => void
	'changed:ui': (config: AppConfig) => void
	'changed:retroachievements': (config: AppConfig) => void
	'changed:superRetrogamers': (config: AppConfig) => void
	'changed:mqttPublish': (config: AppConfig) => void
	'recalbox:added': (payload: { recalbox: RecalboxInstance }) => void
	'recalbox:updated': (payload: { recalbox: RecalboxInstance }) => void
	'recalbox:removed': (payload: { id: string }) => void
}

declare interface ConfigStore {
	on<K extends keyof ConfigStoreEvents>(event: K, listener: ConfigStoreEvents[K]): this
	off<K extends keyof ConfigStoreEvents>(event: K, listener: ConfigStoreEvents[K]): this
	emit<K extends keyof ConfigStoreEvents>(
		event: K,
		...args: Parameters<ConfigStoreEvents[K]>
	): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter pattern
class ConfigStore extends EventEmitter {
	private config: AppConfig | null = null
	// In-memory caches so the read getters stay SYNCHRONOUS even though the libSQL
	// driver is async. Populated by hydrate() (once at process startup) and kept in
	// sync write-through on every mutation below.
	//
	// Write-through only keeps THIS process current, so these rows are trustworthy
	// only in a single long-lived process (scrobbler, MQTT/SSH pools). On Vercel each
	// warm instance drifts from the DB forever. Never gate authorization or the web
	// request path on getRecalboxes()/getRecalbox() — use lib/auth/recalbox-acl.ts,
	// which reads the DB per request.
	private settingsRows: Record<string, string> = {}
	private recalboxRows: RecalboxRow[] = []
	private hydrated = false

	/**
	 * Load settings + recalboxes from the DB into memory. Must be awaited once at
	 * each process entry point (Next.js instrumentation, scrobbler) before any
	 * synchronous getter is used. Idempotent — safe to call again to refresh.
	 */
	async hydrate(): Promise<void> {
		const [settingsRows, recalboxRows] = await Promise.all([getAllSettings(), listRecalboxes()])
		this.settingsRows = settingsRows
		this.recalboxRows = recalboxRows
		this.config = null
		this.hydrated = true
	}

	isHydrated(): boolean {
		return this.hydrated
	}

	get(): AppConfig {
		if (!this.config) {
			const base = mergeDbIntoDefaults(getDefaults(), this.settingsRows)
			const first = this.recalboxRows.find((r) => !r.archived)
			if (first)
				base.recalbox = {
					host: first.host,
					sshUser: first.sshUser,
					sshPassword: first.sshPassword,
					sshPort: first.sshPort,
					mqttPort: first.mqttPort,
				}
			this.config = base
		}
		return this.config
	}

	getForRecalbox(id: string): AppConfig {
		const base = mergeDbIntoDefaults(getDefaults(), this.settingsRows)
		const row = this.recalboxRows.find((r) => r.id === id)
		if (row)
			base.recalbox = {
				host: row.host,
				sshUser: row.sshUser,
				sshPassword: row.sshPassword,
				sshPort: row.sshPort,
				mqttPort: row.mqttPort,
			}
		return base
	}

	async update(partial: DeepPartial<AppConfig>): Promise<AppConfig> {
		const prev = this.get()
		const next = deepMerge(prev, partial)
		const flat = flattenConfig(next)
		const prevFlat = flattenConfig(prev)
		for (const [k, v] of Object.entries(flat)) {
			if (prevFlat[k] !== v) {
				await upsertSetting(k, v)
				this.settingsRows[k] = v
			}
		}
		const scopes = changedScopes(prev, next)
		this.config = next
		if (scopes.length > 0) {
			this.emit('changed', next)
			for (const scope of scopes) this.emit(`changed:${scope}` as keyof ConfigStoreEvents, next)
		}
		return next
	}

	async reset(scope?: keyof AppConfig): Promise<AppConfig> {
		const defaults = getDefaults()
		const prev = this.get()
		if (scope) {
			await deleteSettingsByPrefix(`${scope}.`)
			this.dropSettingsByPrefix(`${scope}.`)
			const next = { ...prev, [scope]: defaults[scope] }
			this.config = next
			if (JSON.stringify(prev[scope]) !== JSON.stringify(next[scope])) {
				this.emit('changed', next)
				this.emit(`changed:${scope}` as keyof ConfigStoreEvents, next)
			}
			return next
		}
		for (const s of Object.keys(defaults) as (keyof AppConfig)[]) {
			await deleteSettingsByPrefix(`${s}.`)
			this.dropSettingsByPrefix(`${s}.`)
		}
		this.config = defaults
		const scopes = changedScopes(prev, defaults)
		if (scopes.length > 0) {
			this.emit('changed', defaults)
			for (const s of scopes) this.emit(`changed:${s}` as keyof ConfigStoreEvents, defaults)
		}
		return defaults
	}

	private dropSettingsByPrefix(prefix: string): void {
		for (const key of Object.keys(this.settingsRows)) {
			if (key.startsWith(prefix)) delete this.settingsRows[key]
		}
	}

	async reload(): Promise<AppConfig> {
		await this.hydrate()
		return this.get()
	}

	async markSetupComplete(): Promise<void> {
		await upsertSetting(SETUP_COMPLETED_KEY, 'true')
		this.settingsRows[SETUP_COMPLETED_KEY] = 'true'
	}

	getRecalboxes(): RecalboxInstance[] {
		return this.recalboxRows.map(rowToInstance)
	}

	getRecalbox(id: string): RecalboxInstance | null {
		const row = this.recalboxRows.find((r) => r.id === id)
		return row ? rowToInstance(row) : null
	}

	getDefaultRecalbox(): RecalboxInstance | null {
		const row = this.recalboxRows.find((r) => r.isDefault)
		if (row) return rowToInstance(row)
		const first = this.recalboxRows[0]
		return first ? rowToInstance(first) : null
	}

	async addRecalbox(
		config: Omit<RecalboxInstance, 'id' | 'isDefault' | 'archived' | 'ownerUserId'>,
		ownerUserId: string | null = null,
	): Promise<RecalboxInstance> {
		const id = randomUUID()
		const row = {
			id,
			...config,
			isDefault: this.recalboxRows.length === 0,
			archived: false,
			ownerUserId,
			createdAt: new Date(),
		}
		await insertRecalbox(row)
		const inserted = await getRecalbox(id)
		if (inserted) this.recalboxRows.push(inserted)
		const instance = rowToInstance(
			inserted ?? {
				...row,
				color: config.color ?? null,
				iconEmoji: config.iconEmoji ?? null,
				lastConnectedAt: null,
			},
		)
		this.emit('recalbox:added', { recalbox: instance })
		if (instance.isDefault) {
			this.config = null
			this.emit('changed:recalbox', this.get())
		}
		return instance
	}

	async updateRecalboxConfig(
		id: string,
		patch: Partial<Omit<RecalboxInstance, 'id'>>,
	): Promise<void> {
		await updateRecalbox(id, {
			...(patch.name !== undefined && { name: patch.name }),
			...(patch.host !== undefined && { host: patch.host }),
			...(patch.sshUser !== undefined && { sshUser: patch.sshUser }),
			...(patch.sshPassword !== undefined && { sshPassword: patch.sshPassword }),
			...(patch.sshPort !== undefined && { sshPort: patch.sshPort }),
			...(patch.mqttPort !== undefined && { mqttPort: patch.mqttPort }),
			...(patch.color !== undefined && { color: patch.color }),
			...(patch.iconEmoji !== undefined && { iconEmoji: patch.iconEmoji }),
			...(patch.archived !== undefined && { archived: patch.archived }),
		})
		const updated = await getRecalbox(id)
		if (!updated) return
		const idx = this.recalboxRows.findIndex((r) => r.id === id)
		if (idx >= 0) this.recalboxRows[idx] = updated
		const instance = rowToInstance(updated)
		this.emit('recalbox:updated', { recalbox: instance })
		this.config = null
		this.emit('changed:recalbox', this.get())
	}

	async removeRecalbox(id: string): Promise<void> {
		await deleteRecalbox(id)
		this.recalboxRows = this.recalboxRows.filter((r) => r.id !== id)
		this.config = null
		this.emit('recalbox:removed', { id })
		this.emit('changed:recalbox', this.get())
	}

	async setDefaultRecalbox(id: string): Promise<void> {
		await setDefaultRecalbox(id)
		this.recalboxRows = this.recalboxRows.map((r) => ({ ...r, isDefault: r.id === id }))
		this.config = null
		const instance = this.getRecalbox(id)
		if (instance) this.emit('recalbox:updated', { recalbox: instance })
		this.emit('changed:recalbox', this.get())
	}
}

const g = globalThis as typeof globalThis & {
	__configStore?: ConfigStore
	__configStoreVersion?: number
}

if (!g.__configStore || g.__configStoreVersion !== SINGLETON_VERSION) {
	g.__configStore = new ConfigStore()
	g.__configStoreVersion = SINGLETON_VERSION
}

export const configStore = g.__configStore
