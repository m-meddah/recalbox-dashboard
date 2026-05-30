/**
 * Session classification by engagement level.
 *
 * - noise: < 2 min (accidental launch or crash, ignored in stats)
 * - bounce: 2-10 min (tried but quit early, weak negative signal)
 * - taste: 10-30 min (gave it a real try, neutral signal)
 * - meaningful: 30 min - 2 h (genuine play session, positive signal)
 * - marathon: > 2 h (immersive session, strong positive signal)
 */
export type SessionClassification = 'noise' | 'bounce' | 'taste' | 'meaningful' | 'marathon'

/**
 * Thresholds in seconds. Exposed as constants so the backfill SQL
 * and TypeScript logic stay in sync.
 */
export const CLASSIFICATION_THRESHOLDS = {
	noiseMax: 120, // < 2 min
	bounceMax: 600, // < 10 min
	tasteMax: 1800, // < 30 min
	meaningfulMax: 7200, // < 2 h
} as const

/**
 * Classifies a session by its duration in seconds.
 * null/undefined → 'noise' (no data means no signal).
 */
export function classifySession(durationSeconds: number | null | undefined): SessionClassification {
	if (durationSeconds == null || durationSeconds < CLASSIFICATION_THRESHOLDS.noiseMax) {
		return 'noise'
	}
	if (durationSeconds < CLASSIFICATION_THRESHOLDS.bounceMax) return 'bounce'
	if (durationSeconds < CLASSIFICATION_THRESHOLDS.tasteMax) return 'taste'
	if (durationSeconds < CLASSIFICATION_THRESHOLDS.meaningfulMax) return 'meaningful'
	return 'marathon'
}

/** Sessions that signal the user is genuinely engaged. */
export const POSITIVE_CLASSIFICATIONS: SessionClassification[] = ['meaningful', 'marathon']

/** Sessions that signal the user didn't stick around. */
export const NEGATIVE_CLASSIFICATIONS: SessionClassification[] = ['bounce']

/** Sessions that tried but leave no clear conclusion. */
export const NEUTRAL_CLASSIFICATIONS: SessionClassification[] = ['taste']

/** Sessions to ignore in statistics (pure noise). */
export const IGNORED_CLASSIFICATIONS: SessionClassification[] = ['noise']
