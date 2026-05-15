import { EventEmitter } from 'node:events'
import { deleteSettingsByPrefix, getAllSettings, upsertSetting } from '@/lib/db/queries'
import { getDefaults } from '@/lib/settings/defaults'
import { type AppConfig, type DeepPartial, SETUP_COMPLETED_KEY } from '@/lib/settings/schemas'

const SINGLETON_VERSION = 1

function flattenConfig(cfg: AppConfig): Record<string, string> {
	const flat: Record<string, string> = {}
	for (const [scope, values] of Object.entries(cfg)) {
		for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
			flat[`${scope}.${key}`] = String(value)
		}
	}
	return flat
}

function mergeDbIntoDefaults(defaults: AppConfig, dbRows: Record<string, string>): AppConfig {
	const result = structuredClone(defaults) as AppConfig & Record<string, Record<string, unknown>>
	for (const [flatKey, rawValue] of Object.entries(dbRows)) {
		if (flatKey.startsWith('__')) continue
		const dotIdx = flatKey.indexOf('.')
		if (dotIdx === -1) continue
		const scope = flatKey.slice(0, dotIdx) as keyof AppConfig
		const key = flatKey.slice(dotIdx + 1)
		if (!result[scope]) continue
		const current = (result[scope] as Record<string, unknown>)[key]
		if (typeof current === 'number') {
			;(result[scope] as Record<string, unknown>)[key] = Number(rawValue)
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
		if (JSON.stringify(prev[scope]) !== JSON.stringify(next[scope])) {
			scopes.push(scope)
		}
	}
	return scopes
}

interface ConfigStoreEvents {
	changed: (config: AppConfig) => void
	'changed:recalbox': (config: AppConfig) => void
	'changed:scrobble': (config: AppConfig) => void
	'changed:ui': (config: AppConfig) => void
	'changed:retroachievements': (config: AppConfig) => void
}

declare interface ConfigStore {
	on<K extends keyof ConfigStoreEvents>(event: K, listener: ConfigStoreEvents[K]): this
	off<K extends keyof ConfigStoreEvents>(event: K, listener: ConfigStoreEvents[K]): this
	emit<K extends keyof ConfigStoreEvents>(
		event: K,
		...args: Parameters<ConfigStoreEvents[K]>
	): boolean
}

class ConfigStore extends EventEmitter {
	private config: AppConfig | null = null

	get(): AppConfig {
		if (!this.config) {
			this.config = mergeDbIntoDefaults(getDefaults(), getAllSettings())
		}
		return this.config
	}

	update(partial: DeepPartial<AppConfig>): AppConfig {
		const prev = this.get()
		const next = deepMerge(prev, partial)
		const flat = flattenConfig(next)

		const prevFlat = flattenConfig(prev)
		for (const [k, v] of Object.entries(flat)) {
			if (prevFlat[k] !== v) {
				upsertSetting(k, v)
			}
		}

		const scopes = changedScopes(prev, next)
		this.config = next

		if (scopes.length > 0) {
			this.emit('changed', next)
			for (const scope of scopes) {
				this.emit(`changed:${scope}` as keyof ConfigStoreEvents, next)
			}
		}

		return next
	}

	reset(scope?: keyof AppConfig): AppConfig {
		const defaults = getDefaults()
		const prev = this.get()

		if (scope) {
			deleteSettingsByPrefix(`${scope}.`)
			const next = { ...prev, [scope]: defaults[scope] }
			this.config = next
			if (JSON.stringify(prev[scope]) !== JSON.stringify(next[scope])) {
				this.emit('changed', next)
				this.emit(`changed:${scope}` as keyof ConfigStoreEvents, next)
			}
			return next
		}

		for (const s of Object.keys(defaults) as (keyof AppConfig)[]) {
			deleteSettingsByPrefix(`${s}.`)
		}
		this.config = defaults
		const scopes = changedScopes(prev, defaults)
		if (scopes.length > 0) {
			this.emit('changed', defaults)
			for (const s of scopes) {
				this.emit(`changed:${s}` as keyof ConfigStoreEvents, defaults)
			}
		}
		return defaults
	}

	reload(): AppConfig {
		const prev = this.config
		this.config = mergeDbIntoDefaults(getDefaults(), getAllSettings())
		if (prev) {
			const scopes = changedScopes(prev, this.config)
			if (scopes.length > 0) {
				this.emit('changed', this.config)
				for (const scope of scopes) {
					this.emit(`changed:${scope}` as keyof ConfigStoreEvents, this.config)
				}
			}
		}
		return this.config
	}

	markSetupComplete(): void {
		upsertSetting(SETUP_COMPLETED_KEY, 'true')
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
