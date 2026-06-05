import { getSshClient } from '@/lib/recalbox/ssh-client'

// EmulationStation mirrors its current state to this file on every transition
// (game start/stop, screensaver, menu). Reading it lets the server know whether a
// game is already running even when no MQTT `game:start` event reached the browser
// (e.g. the game was launched before the page mounted, or from the box itself).
const STATE_FILE = '/recalbox/share/system/.emulationstation/es_state.inf'

export type EsState = {
	/** Whether a game is actively being played right now. */
	gameRunning: boolean
	/** Display name of the running game, when one is playing. */
	gameName: string | null
	/** Raw `key=value` pairs as written by EmulationStation. */
	raw: Record<string, string>
}

/** Parse the `key=value` lines EmulationStation writes to es_state.inf. */
export function parseEsState(content: string): EsState {
	const raw: Record<string, string> = {}
	for (const line of content.split('\n')) {
		const eq = line.indexOf('=')
		if (eq === -1) continue
		const key = line.slice(0, eq).trim()
		if (!key) continue
		raw[key] = line.slice(eq + 1).trim()
	}
	// ES sets State=playing while a game runs, State=selected while browsing menus.
	const gameRunning = raw.State === 'playing'
	return { gameRunning, gameName: gameRunning ? raw.Game || null : null, raw }
}

/**
 * Read the current EmulationStation state from the box over SSH.
 * Returns null when the state can't be read — callers treat that as "unknown" and
 * must not block a launch on it (the file is absent on older firmwares / first boot).
 */
export async function getEsState(recalboxId: string): Promise<EsState | null> {
	try {
		const ssh = getSshClient(recalboxId)
		const content = await ssh.exec(`cat ${STATE_FILE} 2>/dev/null || true`, 5000)
		if (!content.trim()) return null
		return parseEsState(content)
	} catch {
		return null
	}
}
