import type { GameStartEvent, SystemChangeEvent, SystemInfoEvent } from '@/lib/recalbox/events'

export type ActivityState = {
	game: GameStartEvent | null
	screensaver: boolean
	browsing: SystemChangeEvent | null
	lastSystemInfo: SystemInfoEvent | null
}

/** Live state plus the box it describes, so staleness is derivable rather than reset. */
export type StreamState = { box: string | null; activity: ActivityState; mqttOnline: boolean | null }

export const initialActivity: ActivityState = {
	game: null,
	screensaver: false,
	browsing: null,
	lastSystemInfo: null,
}

export const initialStream: StreamState = {
	box: null,
	activity: initialActivity,
	mqttOnline: null,
}

/**
 * Serverless snapshot of what the SSE stream used to deliver. Computed server-side
 * once per render; there is no cloud→box MQTT to keep it fresh.
 */
export type SeedState = {
	box: string | null
	game: GameStartEvent | null
	online: boolean
	lastSeenAt: Date | null
}

/**
 * Fold a server-computed seed into the provider's state shape.
 *
 * `mqttOnline` is deliberately a boolean and never null: null means "still waiting"
 * to every consumer, which would leave them in a permanent loading skeleton. A seed
 * is an answer.
 *
 * Kept out of the provider module so it stays unit-testable without a DOM, and so
 * the provider file only exports components (Fast Refresh).
 */
export function seedToStream(seed: SeedState | null): StreamState {
	if (!seed) return initialStream
	return {
		box: seed.box,
		activity: { ...initialActivity, game: seed.game },
		mqttOnline: seed.online,
	}
}
