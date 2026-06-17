import type { GamePlayStats } from './play-stats'

/**
 * Inherited play time (from gamelist userdata, "temps joué") above which we treat
 * the game as genuinely enjoyed even without any scrobbled session — e.g. a game
 * the user sank hours into before the dashboard started tracking.
 */
const SUBSTANTIAL_INHERITED_SECONDS = 7200 // 2 hours
/** Average inherited seconds per launch below which repeated launches look like bouncing. */
const INHERITED_BOUNCE_AVG_SECONDS = 120 // 2 minutes / launch

/**
 * The user tried this game multiple times but never committed to a real session.
 * Signal to exclude the game from recommendations.
 *
 * Definition (scrobbler): ≥ 2 bounce sessions AND zero significant sessions.
 * Definition (inherited): ≥ 3 launches averaging < 2 min each, with no substantial
 * total time and no significant scrobbler sessions — i.e. repeatedly opened and quit
 * before tracking began.
 */
export function hasBouncedWithoutCommitting(stats: GamePlayStats): boolean {
	if (stats.significantSessions > 0) return false
	if (stats.bounceCount >= 2) return true

	const inh = stats.inherited
	if (inh && inh.playCount >= 3 && inh.playTimeSeconds < SUBSTANTIAL_INHERITED_SECONDS) {
		const avgPerLaunch = inh.playTimeSeconds / inh.playCount
		if (avgPerLaunch < INHERITED_BOUNCE_AVG_SECONDS) return true
	}

	return false
}

/**
 * The user demonstrably enjoys this game.
 * High-confidence signal for recommendations.
 *
 * Definition: ≥ 3 significant sessions, ≥ 1 marathon session, OR ≥ 2 hours of
 * inherited play time accumulated before tracking began.
 */
export function isConfirmedTaste(stats: GamePlayStats): boolean {
	if (stats.significantSessions >= 3 || stats.marathonCount >= 1) return true
	if ((stats.inherited?.playTimeSeconds ?? 0) >= SUBSTANTIAL_INHERITED_SECONDS) return true
	return false
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
