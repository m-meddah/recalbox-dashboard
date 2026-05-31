import type { GamePlayStats } from './play-stats'

/**
 * The user tried this game multiple times but never committed to a real session.
 * Signal to exclude the game from recommendations.
 *
 * Definition: ≥ 2 bounce sessions AND zero significant sessions.
 */
export function hasBouncedWithoutCommitting(stats: GamePlayStats): boolean {
	return stats.bounceCount >= 2 && stats.significantSessions === 0
}

/**
 * The user demonstrably enjoys this game.
 * High-confidence signal for recommendations.
 *
 * Definition: ≥ 3 significant sessions OR ≥ 1 marathon session.
 */
export function isConfirmedTaste(stats: GamePlayStats): boolean {
	return stats.significantSessions >= 3 || stats.marathonCount >= 1
}

/**
 * No meaningful signal yet — not enough data to judge.
 *
 * - No stats at all → untested
 * - Only noise sessions (< 2 min) → untested
 * - Inherited playCount ≥ 3 → NOT untested (user has a history with this game)
 */
export function isUntested(stats: GamePlayStats | null): boolean {
	if (!stats) return true

	if (stats.measuredSessions === 0) {
		if (stats.inherited && stats.inherited.playCount >= 3) return false
		return true
	}

	// All measured sessions are noise → no real signal
	if (stats.measuredSessions === stats.noiseCount) return true

	return false
}

/**
 * Months elapsed since the last meaningful or marathon session.
 * Falls back to inherited lastPlayedAt when no measured sessions exist.
 * Returns Infinity when the game has never been played seriously.
 */
export function monthsSinceLastMeaningfulPlay(stats: GamePlayStats): number {
	const date = stats.lastMeaningfulPlayAt ?? stats.inherited?.lastPlayedAt ?? null

	if (!date) return Number.POSITIVE_INFINITY

	return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 30)
}

/**
 * A game the user returns to regularly with sustained engagement.
 *
 * Definition: ≥ 5 meaningful sessions OR ≥ 2 marathon sessions.
 */
export function isComfortGame(stats: GamePlayStats): boolean {
	return stats.meaningfulCount >= 5 || stats.marathonCount >= 2
}
