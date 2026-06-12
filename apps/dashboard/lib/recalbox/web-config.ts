import { logger } from '@/lib/logger'

/**
 * Client for the Recalbox Web Manager configuration API (port 81) — the same
 * source the official Web Manager uses to read and write `recalbox.conf`.
 *
 * Wire format, verified against a live box:
 *   GET  /api/configuration/{section}  -> { "<key>": { exist: bool, value: bool|number|string } }
 *   POST /api/configuration/{section}  with a FLAT body { "<key>": <value>, ... }
 *        applies the given keys and returns the full updated section. An empty
 *        body is a no-op that just echoes the current section.
 *   POST /api/system/frontend/{restart|start|stop}  controls EmulationStation.
 */

export type ConfigValue = boolean | number | string

export type ConfigField = {
	key: string
	value: ConfigValue
	exist: boolean
	/** True when the value has been masked before leaving the server (secrets). */
	secret?: boolean
}

export type FrontendAction = 'restart' | 'start' | 'stop'

/** 0 = Unknown, 1 = High, 2 = Good, 3 = Average, 4 = Low (Web Manager enum). */
export type EmulatorRating = 0 | 1 | 2 | 3 | 4

export type EmulatorChoice = {
	emulator: string
	core: string
	/** Lower is the recalbox-recommended default (priority 1). */
	priority: number
	speed: EmulatorRating
	compatibility: EmulatorRating
	hasNetplay: boolean
}

export type SystemCatalogEntry = {
	name: string
	fullName: string
	manufacturer: string
	emulators: EmulatorChoice[]
}

/**
 * Placeholder sent to the client in place of a secret value, and the signal
 * that a secret field was left untouched and must NOT be written back.
 */
export const SECRET_SENTINEL = '••••••'

const DEFAULT_PORT = 81
const READ_TIMEOUT_MS = 6000
const WRITE_TIMEOUT_MS = 8000

type RawEntry = { exist?: boolean; value?: ConfigValue }

function base(host: string, port: number): string {
	return `http://${host}:${port}/api`
}

/** Read a configuration section. Best-effort: returns [] when unreachable. */
export async function fetchConfigSection(
	host: string,
	section: string,
	port = DEFAULT_PORT,
): Promise<ConfigField[]> {
	try {
		const res = await fetch(`${base(host, port)}/configuration/${section}`, {
			signal: AbortSignal.timeout(READ_TIMEOUT_MS),
		})
		if (!res.ok) return []
		return normalizeSection(await res.json())
	} catch (err) {
		logger.warn(`Failed to read recalbox config section "${section}"`, err)
		return []
	}
}

/**
 * Write the given keys to a configuration section. Only the keys passed are
 * sent (the API merges them); callers should pass changed keys only. Throws
 * when the box rejects the write or is unreachable, so routes can surface 503.
 */
export async function saveConfigSection(
	host: string,
	section: string,
	changes: Record<string, ConfigValue>,
	port = DEFAULT_PORT,
): Promise<void> {
	const res = await fetch(`${base(host, port)}/configuration/${section}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(changes),
		signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
	})
	if (!res.ok) {
		// Never log `changes` — it may carry secrets (Wi-Fi keys, passwords).
		throw new Error(`Config write to "${section}" failed with status ${res.status}`)
	}
}

/** Control EmulationStation (apply settings that need a frontend restart). */
export async function restartFrontend(
	host: string,
	action: FrontendAction,
	port = DEFAULT_PORT,
): Promise<void> {
	const res = await fetch(`${base(host, port)}/system/frontend/${action}`, {
		method: 'POST',
		signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
	})
	if (!res.ok) {
		throw new Error(`Frontend "${action}" failed with status ${res.status}`)
	}
}

type RawEmulator = {
	emulator?: string
	core?: string
	priority?: number
	speed?: number
	compatibility?: number
	hasNetplay?: boolean
}

type RawSystem = {
	name?: string
	fullName?: string
	manufacturer?: string
	emulators?: RawEmulator[]
}

function toRating(n: number | undefined): EmulatorRating {
	return n === 1 || n === 2 || n === 3 || n === 4 ? n : 0
}

/** Available emulator/core choices per system, from the Web Manager catalog. */
export async function fetchSystemsCatalog(
	host: string,
	port = DEFAULT_PORT,
): Promise<SystemCatalogEntry[]> {
	try {
		const res = await fetch(`${base(host, port)}/systems`, {
			signal: AbortSignal.timeout(READ_TIMEOUT_MS),
		})
		if (!res.ok) return []
		const data = (await res.json()) as { systems?: RawSystem[] }
		const out: SystemCatalogEntry[] = []
		for (const sys of data.systems ?? []) {
			if (!sys?.name) continue
			const emulators: EmulatorChoice[] = []
			for (const e of sys.emulators ?? []) {
				if (!e?.emulator || !e?.core) continue
				emulators.push({
					emulator: e.emulator,
					core: e.core,
					priority: e.priority ?? 99,
					speed: toRating(e.speed),
					compatibility: toRating(e.compatibility),
					hasNetplay: e.hasNetplay ?? false,
				})
			}
			// Only systems that actually offer an emulator are worth listing.
			if (emulators.length === 0) continue
			emulators.sort((a, b) => a.priority - b.priority)
			out.push({
				name: sys.name,
				fullName: sys.fullName || sys.name,
				manufacturer: sys.manufacturer ?? '',
				emulators,
			})
		}
		return out.sort((a, b) => a.fullName.localeCompare(b.fullName))
	} catch (err) {
		logger.warn('Failed to read Recalbox systems catalog', err)
		return []
	}
}

function normalizeSection(data: unknown): ConfigField[] {
	if (!data || typeof data !== 'object') return []
	const out: ConfigField[] = []
	for (const [key, raw] of Object.entries(data as Record<string, RawEntry>)) {
		if (!raw || typeof raw !== 'object') continue
		const value = raw.value
		if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
			continue
		}
		out.push({ key, value, exist: raw.exist ?? false })
	}
	return out.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Replace the value of secret keys with {@link SECRET_SENTINEL} so they never
 * reach the browser. `isSecret` decides per key (driven by the config schema).
 */
export function maskSecrets(
	fields: ConfigField[],
	isSecret: (key: string) => boolean,
): ConfigField[] {
	return fields.map((f) =>
		isSecret(f.key) ? { ...f, value: f.value === '' ? '' : SECRET_SENTINEL, secret: true } : f,
	)
}
