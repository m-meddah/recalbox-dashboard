import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { raAchievements, raGameProgress } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import {
	getGameInfoAndUserProgress,
	getUserRecentAchievements,
} from '@retroachievements/api'
import { eq } from 'drizzle-orm'
import { getAuth } from './auth'
import { purgeExpiredCache } from './cache'
import { withRateLimit } from './rate-limiter'

async function syncRecentAchievements(): Promise<void> {
	const { username } = getAuth()
	const recent = await withRateLimit(() =>
		getUserRecentAchievements(getAuth(), { username }),
	)

	const now = new Date()

	const gameIds = new Set<number>()

	for (const a of recent) {
		db.insert(raAchievements)
			.values({
				id: a.achievementId,
				gameId: a.gameId,
				title: a.title,
				points: a.points,
				imageUrl: `https://media.retroachievements.org/Badge/${a.badgeName}.png`,
				unlockedAt: new Date(a.date),
				isHardcore: a.hardcoreMode,
				syncedAt: now,
			})
			.onConflictDoUpdate({
				target: raAchievements.id,
				set: { syncedAt: now },
			})
			.run()
		gameIds.add(a.gameId)
	}

	// Sync game progress for each game that had recent activity
	for (const gameId of gameIds) {
		try {
			const { username } = getAuth()
			const info = await withRateLimit(() =>
				getGameInfoAndUserProgress(getAuth(), { gameId, username }),
			)

			const numAwarded = Object.values(info.achievements).filter(
				(a) => a.dateEarned !== undefined,
			).length
			const numAwardedHardcore = Object.values(info.achievements).filter(
				(a) => a.dateEarnedHardcore !== undefined,
			).length
			const maxPoints = Object.values(info.achievements).reduce(
				(sum, a) => sum + (a.points ?? 0),
				0,
			)
			const earnedPoints = Object.values(info.achievements)
				.filter((a) => a.dateEarned !== undefined)
				.reduce((sum, a) => sum + (a.points ?? 0), 0)

			db.insert(raGameProgress)
				.values({
					gameId,
					title: info.title,
					imageIcon: info.imageIcon,
					numAchievements: info.numAchievements,
					numAwarded,
					numAwardedHardcore,
					points: earnedPoints,
					maxPoints,
					consoleId: info.consoleId,
					consoleName: info.consoleName,
					syncedAt: now,
				})
				.onConflictDoUpdate({
					target: raGameProgress.gameId,
					set: {
						numAwarded,
						numAwardedHardcore,
						points: earnedPoints,
						syncedAt: now,
					},
				})
				.run()
		} catch (err) {
			logger.warn(`Failed to sync RA game progress for game ${gameId}`, err)
		}
	}
}

export async function syncRetroAchievements(): Promise<void> {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled || !cfg.username || !cfg.apiKey) return

	logger.info('RA sync starting')
	try {
		await syncRecentAchievements()
		purgeExpiredCache()
		logger.info('RA sync complete')
	} catch (err) {
		logger.error('RA sync failed', err)
		throw err
	}
}
