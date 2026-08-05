'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'

/**
 * Tracks whether a real (non-screensaver) game is currently running on the Recalbox.
 * Used to prevent launching a second game while one is in progress — EmulationStation
 * can't switch mid-game and would apply the queued command only when the player
 * returns to the menu.
 *
 * Reads the provider's folded `activity.game` state, which is seeded server-side in
 * serverless mode and replayed from `lastKnownGame` on SSE connect in self-hosted
 * mode — so it reflects a game already running when the page loaded, not just events
 * seen since mount.
 */
export function useGameRunning(): { running: boolean; gameName: string | null } {
	const { activity } = useRecalboxEvents()
	const game = activity.game && !activity.game.fromScreensaver ? activity.game : null

	return { running: game !== null, gameName: game?.gameName ?? null }
}
