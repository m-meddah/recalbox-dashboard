import { db } from '@/lib/db/index'
import { pendingFeedback } from '@/lib/db/schema'
import { and, isNull, lt } from 'drizzle-orm'

/**
 * Deletes expired pending feedback entries that were never answered.
 * Answered entries are kept for future analysis.
 *
 * @returns Number of deleted rows.
 */
export async function cleanupExpiredFeedback(): Promise<number> {
	const now = new Date()
	const result = await db
		.delete(pendingFeedback)
		.where(and(lt(pendingFeedback.expiresAt, now), isNull(pendingFeedback.respondedAt)))
	return Number((result as unknown as { changes?: number }).changes ?? 0)
}
