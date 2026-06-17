import { logger } from '@/lib/logger'
import { RECALBOX_CONF_PATH, parseConfValues } from './recalbox-conf-editor'
import { shellQuote } from './shell'
import { getSshClient } from './ssh-client'

export const OVERCLOCK_KEY = 'system.overclocking'
export const OVERCLOCK_BASE = '/recalbox/system/configs/overclocking'

export type ThrottleStatus = {
	raw: string
	underVoltageNow: boolean
	throttledNow: boolean
	underVoltageOccurred: boolean
	throttledOccurred: boolean
}

export type OverclockInfo = {
	/** False when the board has no overclocking profiles (non-Pi, or none found). */
	supported: boolean
	modelName: string | null
	board: string | null
	profilesDir: string | null
	/** Available profile basenames, e.g. ['medium', 'high']. */
	available: string[]
	/** Active profile basename, or null for stock clocks. */
	current: string | null
	/** CPU temperature in °C. */
	temp: number | null
	throttle: ThrottleStatus | null
}

/** Map a /proc/device-tree/model string to a Recalbox overclocking board id. */
export function boardFromModel(model: string | null): string | null {
	if (!model) return null
	const m = model.toLowerCase()
	if (!m.includes('raspberry pi')) return null
	// "Raspberry Pi 5 Model B" → rpi5, "Raspberry Pi 4 Model B" → rpi4, etc.
	const match = m.match(/raspberry pi\s+(\d+)/)
	return match ? `rpi${match[1]}` : null
}

/** Parse the hex word from `vcgencmd get_throttled` (e.g. "throttled=0x50005"). */
export function parseThrottle(raw: string | null): ThrottleStatus | null {
	if (!raw) return null
	const match = raw.match(/0x[0-9a-fA-F]+/)
	if (!match) return null
	const bits = Number.parseInt(match[0], 16)
	if (Number.isNaN(bits)) return null
	return {
		raw: match[0],
		underVoltageNow: (bits & 0x1) !== 0,
		throttledNow: (bits & 0x4) !== 0,
		underVoltageOccurred: (bits & 0x10000) !== 0,
		throttledOccurred: (bits & 0x40000) !== 0,
	}
}

/** Strip the directory and `.txt` suffix from a profile path. */
export function profileBasename(path: string | null): string | null {
	if (!path) return null
	const base = path.slice(path.lastIndexOf('/') + 1)
	return base.endsWith('.txt') ? base.slice(0, -4) : base
}

function dirname(path: string): string {
	const i = path.lastIndexOf('/')
	return i <= 0 ? '' : path.slice(0, i)
}

/** Parse the `ls -1 <dir>/*.txt` output into sorted profile basenames. */
export function parseProfileList(raw: string): string[] {
	return raw
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.endsWith('.txt'))
		.map((l) => l.slice(l.lastIndexOf('/') + 1, -4))
		.sort()
}

/**
 * Read the overclocking state of the active Recalbox: model, available profiles,
 * current profile, and live thermal/throttle status. Best-effort — returns a
 * `supported: false` shape when the board has no profiles or is unreachable.
 */
export async function readOverclockInfo(recalboxId: string): Promise<OverclockInfo> {
	const empty: OverclockInfo = {
		supported: false,
		modelName: null,
		board: null,
		profilesDir: null,
		available: [],
		current: null,
		temp: null,
		throttle: null,
	}

	try {
		const ssh = getSshClient(recalboxId)
		const [conf, modelRaw, tempRaw, throttleRaw] = await Promise.all([
			ssh.exec(`cat ${shellQuote(RECALBOX_CONF_PATH)} 2>/dev/null || true`, 10_000),
			ssh.exec('tr -d "\\0" < /proc/device-tree/model 2>/dev/null || true').catch(() => ''),
			ssh.exec('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || true').catch(() => ''),
			ssh.exec('vcgencmd get_throttled 2>/dev/null || true').catch(() => ''),
		])

		const modelName = modelRaw.trim() || null
		const tempVal = Number.parseInt(tempRaw.trim(), 10)
		const temp = Number.isNaN(tempVal) ? null : tempVal / 1000
		const throttle = parseThrottle(throttleRaw)

		const currentValue = parseConfValues(conf, [OVERCLOCK_KEY])[OVERCLOCK_KEY]
		// Prefer the directory of the active profile; fall back to the detected board.
		const board = boardFromModel(modelName)
		const profilesDir = currentValue
			? dirname(currentValue)
			: board
				? `${OVERCLOCK_BASE}/${board}`
				: null

		let available: string[] = []
		if (profilesDir) {
			const listRaw = await ssh
				.exec(`ls -1 ${shellQuote(profilesDir)}/*.txt 2>/dev/null || true`, 10_000)
				.catch(() => '')
			available = parseProfileList(listRaw)
		}

		return {
			supported: available.length > 0,
			modelName,
			board,
			profilesDir,
			available,
			current: profileBasename(currentValue ?? null),
			temp,
			throttle,
		}
	} catch (err) {
		logger.warn('readOverclockInfo failed', err)
		return empty
	}
}
