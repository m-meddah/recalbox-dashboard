// Parsers for Recalbox MQTT events.
// Confirmed topics and payload shapes via mosquitto_sub on a live Recalbox 10.
//
// Known quirks:
// - EmulationStation appends a second copy of the JSON in the same MQTT payload (double-publish bug).
//   We recover by slicing to the position reported in the SyntaxError.

const ES_EVENT_TOPIC = 'Recalbox/WebAPI/EmulationStation/Event'
const SYSTEM_INFO_TOPIC = 'Recalbox/WebAPI/SystemInfo'

export type GameStartEvent = {
	type: 'game:start'
	system: string
	systemFullName: string
	gameName: string
	romPath: string
	imagePath?: string
	emulator?: string
	startedAt: Date
	/** True when the game was launched by the screensaver (demo/attractmode). Scrobbler ignores these. */
	fromScreensaver?: boolean
}

export type GameStopEvent = {
	type: 'game:stop'
	system: string
	gameName: string
	romPath: string
	stoppedAt: Date
}

export type SystemChangeEvent = {
	type: 'system:change'
	system: string
	systemFullName: string
	gameName?: string
	imagePath?: string
}

export type ScreensaverStartEvent = {
	type: 'screensaver:start'
}

export type ScreensaverStopEvent = {
	type: 'screensaver:stop'
}

export type SystemInfoEvent = {
	type: 'system:info'
	timestamp: string
	/** Average CPU usage across all cores, 0–100 */
	cpuPercent: number
	memUsedMb: number
	memTotalMb: number
	tempCelsius: number
}

export type RecalboxEvent =
	| GameStartEvent
	| GameStopEvent
	| SystemChangeEvent
	| SystemInfoEvent
	| ScreensaverStartEvent
	| ScreensaverStopEvent

// ── Recalbox/WebAPI/EmulationStation/Event shape ─────────────────────────────

type WebApiEventPayload = {
	event: string
	param: string
	system: {
		name: string
		fullname: string
		defaultEmulator: string
		defaultCore: string
	}
	game: {
		romPath: string
		name: string
		[key: string]: unknown
	}
	media: {
		image: string
		thumbnail: string
		video: string
	}
}

function isWebApiPayload(v: unknown): v is WebApiEventPayload {
	if (typeof v !== 'object' || v === null) return false
	const o = v as Record<string, unknown>
	return (
		typeof o.event === 'string' &&
		typeof o.system === 'object' &&
		o.system !== null &&
		typeof o.game === 'object' &&
		o.game !== null &&
		typeof o.media === 'object' &&
		o.media !== null
	)
}

// ── Recalbox/WebAPI/SystemInfo shape ─────────────────────────────────────────

type SystemInfoPayload = {
	timestamp: string
	cpus: Record<string, { consumption: number[] }>
	memory: { total: number; free: number[]; available: number[] }
	temperature: { unit: string; temperatures: number[] }
}

function isSystemInfoPayload(v: unknown): v is SystemInfoPayload {
	if (typeof v !== 'object' || v === null) return false
	const o = v as Record<string, unknown>
	return (
		typeof o.timestamp === 'string' &&
		typeof o.cpus === 'object' &&
		o.cpus !== null &&
		typeof o.memory === 'object' &&
		o.memory !== null &&
		typeof o.temperature === 'object' &&
		o.temperature !== null
	)
}

function parseSystemInfo(data: SystemInfoPayload): SystemInfoEvent {
	const cores = Object.values(data.cpus)
	const cpuPercent =
		cores.length > 0 ? cores.reduce((sum, c) => sum + (c.consumption[0] ?? 0), 0) / cores.length : 0

	const totalBytes = data.memory.total
	const freeBytes = data.memory.free[0] ?? 0
	const usedBytes = totalBytes - freeBytes
	const MB = 1024 * 1024

	return {
		type: 'system:info',
		timestamp: data.timestamp,
		cpuPercent: Math.round(cpuPercent * 10) / 10,
		memUsedMb: Math.round(usedBytes / MB),
		memTotalMb: Math.round(totalBytes / MB),
		tempCelsius: data.temperature.temperatures[0] ?? 0,
	}
}

// ── Public parser ─────────────────────────────────────────────────────────────

/**
 * Transforms a raw MQTT message into a typed RecalboxEvent.
 * Returns null for unknown topics, unexpected payloads, or non-actionable events.
 * Never throws.
 */
export function parseRecalboxMessage(topic: string, payload: Buffer): RecalboxEvent | null {
	if (topic === ES_EVENT_TOPIC) return parseEmulationStationEvent(payload)
	if (topic === SYSTEM_INFO_TOPIC) return parseSystemInfoMessage(payload)
	return null
}

function parseEmulationStationEvent(payload: Buffer): RecalboxEvent | null {
	// EmulationStation appends a second JSON copy in the same payload — strip null bytes
	// and recover by slicing to the SyntaxError position on the first parse attempt.
	const raw = payload.toString('utf-8').replace(/\0/g, '')
	let data: unknown
	try {
		data = JSON.parse(raw)
	} catch (firstErr) {
		const pos = (
			firstErr instanceof SyntaxError ? firstErr.message.match(/position (\d+)/) : null
		)?.[1]
		if (!pos) return null
		try {
			data = JSON.parse(raw.slice(0, Number(pos)))
		} catch {
			return null
		}
	}

	if (!isWebApiPayload(data)) return null

	const { event, system, game, media } = data

	switch (event) {
		case 'rungame':
			return {
				type: 'game:start',
				system: system.name,
				systemFullName: system.fullname,
				gameName: game.name,
				romPath: game.romPath,
				imagePath: media.image || undefined,
				emulator: system.defaultEmulator || undefined,
				startedAt: new Date(),
			}

		case 'endgame':
			return {
				type: 'game:stop',
				system: system.name,
				gameName: game.name,
				romPath: game.romPath,
				stoppedAt: new Date(),
			}

		case 'gamebrowsing':
			return {
				type: 'system:change',
				system: system.name,
				systemFullName: system.fullname,
				gameName: game.name || undefined,
				imagePath: media.image || undefined,
			}

		case 'sleep':
			return { type: 'screensaver:start' }

		case 'wakeup':
			return { type: 'screensaver:stop' }

		default:
			return null
	}
}

function parseSystemInfoMessage(payload: Buffer): SystemInfoEvent | null {
	let data: unknown
	try {
		data = JSON.parse(payload.toString('utf-8'))
	} catch {
		return null
	}

	if (!isSystemInfoPayload(data)) return null
	return parseSystemInfo(data)
}
