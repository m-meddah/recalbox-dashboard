import type { GamePlayStats } from '@/lib/games/play-stats'
import type { ReasonKey } from './types'

export type HltbDurations = {
	mainStory: number | null
	mainExtras: number | null
	completionist: number | null
}

export type FinishAssessment =
	| { eligible: false }
	| {
			eligible: true
			points: number
			reasons: ReasonKey[]
			breakdown: Record<string, number>
	  }

/** Real time invested before a game counts as "in progress" rather than "tried once". */
const MIN_PLAYED_SECONDS = 15 * 60
/** Base points for being a genuine in-progress game, with and without a HLTB reference. */
const BASE_WITH_HLTB = 35
const BASE_WITHOUT_HLTB = 30

const MONTH_MS = 1000 * 60 * 60 * 24 * 30

/**
 * Scores a candidate for the "finish a game" mood.
 *
 * The mood is about *progress*: a game you have really started and could
 * plausibly see the end of. Three earlier rules made it about something else
 * entirely and shrank the pool to a handful of arcade shmups:
 *
 * - `playCount >= 2` with no time floor treated two 90-second launches as
 *   "in progress";
 * - a hard 6-month recency cut dropped exactly the games worth finishing — the
 *   ones you abandoned;
 * - the time fit compared the *total* HLTB length to tonight's minutes and
 *   discarded anything above it, so every RPG was excluded by construction.
 *
 * The replacement keys off time already invested, ranks on the time *remaining*,
 * and demotes rather than deletes the games too long for tonight.
 */
export function assessFinishCandidate(
	stats: GamePlayStats | null,
	hltb: HltbDurations | null,
	availableMinutes: number,
	now: number = Date.now(),
): FinishAssessment {
	if (!stats) return { eligible: false }

	const playedSeconds = stats.totalPlaytimeSeconds + (stats.inherited?.playTimeSeconds ?? 0)
	const engaged = playedSeconds >= MIN_PLAYED_SECONDS || stats.significantSessions >= 1
	if (!engaged) return { eligible: false }

	const reasons: ReasonKey[] = [{ key: 'inProgress' }]
	const breakdown: Record<string, number> = {}

	const reference = hltb ? (hltb.mainStory ?? hltb.mainExtras ?? hltb.completionist) : null
	const base = reference !== null ? BASE_WITH_HLTB : BASE_WITHOUT_HLTB
	breakdown.finishMode = base
	let points = base

	if (reference !== null) {
		const remaining = Math.max(0, reference - playedSeconds)
		const ratio = remaining / 60 / availableMinutes
		const formatted = formatDuration(remaining)

		let timeFit: number
		if (ratio <= 1) {
			timeFit = 40
			reasons.push({ key: 'finishableTonight', params: { duration: formatted } })
		} else if (ratio <= 2) {
			timeFit = 25
			reasons.push({ key: 'oneTwoSessions', params: { duration: formatted } })
		} else if (ratio <= 4) {
			timeFit = 10
		} else {
			// Too long to make a dent tonight, but still a game you want to finish:
			// demoted, never dropped. Deleting it is what emptied the pool.
			timeFit = -15
		}
		points += timeFit
		breakdown.hltbTimeFit = timeFit

		const progress = playedSeconds / reference
		const progressPts = progressBonus(progress)
		if (progressPts !== 0) {
			points += progressPts
			breakdown.finishProgress = progressPts
		}
		if (progress >= 0.9) {
			reasons.push({ key: 'almostDone', params: { pct: Math.min(99, Math.round(progress * 100)) } })
		}
	}

	const lastPlay =
		stats.lastMeaningfulPlayAt ?? stats.lastPlayedAt ?? stats.inherited?.lastPlayedAt ?? null
	const monthsSince = lastPlay ? (now - lastPlay.getTime()) / MONTH_MS : Number.POSITIVE_INFINITY

	if (monthsSince < 3) {
		points += 10
		breakdown.finishRecent = 10
		// Replaces the generic "in progress" headline rather than stacking with it:
		// the card only shows three reasons, and this one says strictly more.
		reasons[0] = { key: 'resumeWhereYouLeftOff' }
	} else if (monthsSince > 24) {
		// Two years on, the save file is a stranger — worth proposing, worth ranking last.
		points -= 10
		breakdown.finishStale = -10
	}

	return { eligible: true, points, reasons, breakdown }
}

/**
 * Peaks across the 20-80% band — the stretch where a game is unmistakably
 * underway — and tapers to nothing at both ends, where "barely started" and
 * "basically done" are weaker calls to action than the remaining-time fit.
 */
function progressBonus(progress: number): number {
	if (progress <= 0.05 || progress >= 1) return 0
	if (progress < 0.2) return Math.round(20 * ((progress - 0.05) / 0.15))
	if (progress <= 0.8) return 20
	return Math.round(20 * ((1 - progress) / 0.2))
}

export function formatDuration(seconds: number): string {
	const hours = seconds / 3600
	if (hours < 1) return `${Math.round(seconds / 60)}min`
	return `~${Math.round(hours)}h`
}
