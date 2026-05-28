import { db } from '@/lib/db/index'
import { gameRatings, games, pendingFeedback } from '@/lib/db/schema'
import { and, eq, gt, isNull } from 'drizzle-orm'

const RESPONSE_TO_RATING: Record<string, 'love' | 'like' | 'dislike' | 'unknown' | null> = {
	not_for_me: 'dislike',
	come_back_later: null,
	good_but_timing: 'like',
	meh: 'dislike',
	mixed: 'unknown',
	want_more: 'like',
	so_so: 'dislike',
	good: 'like',
	excellent: 'love',
	memorable: 'love',
	dismiss: null,
}

export type PendingFeedbackWithGame = {
	id: number
	sessionId: number
	gameId: number
	durationSeconds: number
	classification: string
	createdAt: Date
	shownAt: Date | null
	name: string
	system: string
	imagePath: string | null
}

class FeedbackService {
	async getUnpushed(): Promise<Array<{ id: number }>> {
		const now = new Date()
		return db
			.select({ id: pendingFeedback.id })
			.from(pendingFeedback)
			.where(
				and(
					eq(pendingFeedback.pushedInApp, false),
					isNull(pendingFeedback.respondedAt),
					gt(pendingFeedback.expiresAt, now),
				),
			)
			.all()
	}

	async markPushed(id: number): Promise<void> {
		await db.update(pendingFeedback).set({ pushedInApp: true }).where(eq(pendingFeedback.id, id))
	}

	async getPending(): Promise<PendingFeedbackWithGame[]> {
		const now = new Date()
		return db
			.select({
				id: pendingFeedback.id,
				sessionId: pendingFeedback.sessionId,
				gameId: pendingFeedback.gameId,
				durationSeconds: pendingFeedback.durationSeconds,
				classification: pendingFeedback.classification,
				createdAt: pendingFeedback.createdAt,
				shownAt: pendingFeedback.shownAt,
				name: games.name,
				system: games.system,
				imagePath: games.imagePath,
			})
			.from(pendingFeedback)
			.innerJoin(games, eq(games.id, pendingFeedback.gameId))
			.where(and(isNull(pendingFeedback.respondedAt), gt(pendingFeedback.expiresAt, now)))
			.orderBy(pendingFeedback.createdAt)
			.all() as PendingFeedbackWithGame[]
	}

	async respond(feedbackId: number, response: string): Promise<{ ratingApplied: string | null }> {
		const feedback = await db
			.select()
			.from(pendingFeedback)
			.where(eq(pendingFeedback.id, feedbackId))
			.get()

		if (!feedback) throw new Error('Feedback not found')

		await db
			.update(pendingFeedback)
			.set({ respondedAt: new Date() })
			.where(eq(pendingFeedback.id, feedbackId))

		const rating = RESPONSE_TO_RATING[response] ?? null
		if (rating) {
			await db
				.insert(gameRatings)
				.values({
					gameId: feedback.gameId,
					rating,
					source: 'post_session',
					ratedAt: new Date(),
					triggeredBySessionId: feedback.sessionId,
				})
				.onConflictDoUpdate({
					target: gameRatings.gameId,
					set: {
						rating,
						source: 'post_session',
						ratedAt: new Date(),
						triggeredBySessionId: feedback.sessionId,
					},
				})
		}

		return { ratingApplied: rating }
	}

	async dismiss(feedbackId: number): Promise<void> {
		await db
			.update(pendingFeedback)
			.set({ shownAt: new Date() })
			.where(eq(pendingFeedback.id, feedbackId))
	}
}

export const feedbackService = new FeedbackService()
