import { db } from '@/lib/db/index'
import { gameRatings, pendingFeedback } from '@/lib/db/schema'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'

const MAX_PENDING_FEEDBACK = 5
const RECENT_RATING_DAYS = 30

/**
 * Decides whether the scrobbler should create a pending_feedback entry for this session.
 *
 * Exclusion rules:
 * - 'noise' sessions (< 2 min) → never prompt
 * - Recent rating (< 30 days) that is NOT 'unknown' → don't bother the user
 * - 5+ pending unanswered entries → queue is saturated
 *
 * A recent 'unknown' rating allows re-prompting: the next session may clarify.
 */
export async function shouldPromptForFeedback(params: {
	gameId: number
	classification: string
}): Promise<boolean> {
	if (params.classification === 'noise') return false

	const recentCutoff = new Date()
	recentCutoff.setDate(recentCutoff.getDate() - RECENT_RATING_DAYS)

	const recentRating = await db
		.select({ rating: gameRatings.rating })
		.from(gameRatings)
		.where(and(eq(gameRatings.gameId, params.gameId), gt(gameRatings.ratedAt, recentCutoff)))
		.get()

	if (recentRating && recentRating.rating !== 'unknown') return false

	const now = new Date()
	const pendingCount = await db
		.select({ c: sql<number>`COUNT(*)` })
		.from(pendingFeedback)
		.where(and(isNull(pendingFeedback.respondedAt), gt(pendingFeedback.expiresAt, now)))
		.get()

	if (Number(pendingCount?.c ?? 0) >= MAX_PENDING_FEEDBACK) return false

	return true
}
