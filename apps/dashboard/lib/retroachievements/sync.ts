import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { raAchievements, raGameProgress } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { notificationService } from '@/lib/notifications/service'
import { sendWebPush } from '@/lib/notifications/web-push'
import {
	getGameInfoAndUserProgress,
	getUserCompletedGames,
	getUserRecentAchievements,
} from '@retroachievements/api'
import { eq, inArray } from 'drizzle-orm'
import { getAuth } from './auth'
import { purgeExpiredCache } from './cache'
import { withRateLimit } from './rate-limiter'

async function syncRecentAchievements(): Promise<void> {
	const { username } = getAuth()
	const recent = await withRateLimit(() => getUserRecentAchievements(getAuth(), { username }))

	if (recent.length === 0) return

	const now = new Date()

	// Detect which achievements are genuinely new (not yet in DB)
	const incomingIds = recent.map((a) => a.achievementId)
	const existingRows = db
		.select({ id: raAchievements.id })
		.from(raAchievements)
		.where(inArray(raAchievements.id, incomingIds))
		.all()
	const existingIds = new Set(existingRows.map((r) => r.id))

	const gameIds = new Set<number>()

	for (const a of recent) {
		const isNew = !existingIds.has(a.achievementId)
		const imageUrl = `https://media.retroachievements.org/Badge/${a.badgeName}.png`

		db.insert(raAchievements)
			.values({
				id: a.achievementId,
				gameId: a.gameId,
				title: a.title,
				points: a.points,
				imageUrl,
				unlockedAt: new Date(a.date),
				isHardcore: a.hardcoreMode,
				syncedAt: now,
			})
			.onConflictDoUpdate({
				target: raAchievements.id,
				set: { syncedAt: now },
			})
			.run()

		if (isNew) {
			const gameProgress = db
				.select()
				.from(raGameProgress)
				.where(eq(raGameProgress.gameId, a.gameId))
				.get()
			notificationService
				.create({
					type: 'achievement.unlocked',
					data: {
						achievementId: a.achievementId,
						title: a.title,
						points: a.points,
						imageUrl,
						isHardcore: a.hardcoreMode,
						gameTitle: gameProgress?.title ?? `Game #${a.gameId}`,
						gameId: a.gameId,
					},
				})
				.then((notif) => {
					if (notif) sendWebPush(notif).catch(() => {})
				})
				.catch(() => {})
		}

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

async function syncAllGameProgress(): Promise<void> {
	const { username } = getAuth()
	const now = new Date()
	const completedGames = await withRateLimit(() => getUserCompletedGames(getAuth(), { username }))

	if (completedGames.length === 0) return

	// getUserCompletedGames may return duplicate entries (softcore + hardcore) — keep best numAwarded
	const byGameId = new Map<
		number,
		{ numAwarded: number; numAwardedHardcore: number; entry: (typeof completedGames)[0] }
	>()
	for (const g of completedGames) {
		const existing = byGameId.get(g.gameId)
		if (!existing || g.numAwarded > existing.numAwarded) {
			byGameId.set(g.gameId, {
				numAwarded: g.numAwarded,
				numAwardedHardcore: g.hardcoreMode ? g.numAwarded : (existing?.numAwardedHardcore ?? 0),
				entry: g,
			})
		} else if (g.hardcoreMode && g.numAwarded > existing.numAwardedHardcore) {
			existing.numAwardedHardcore = g.numAwarded
		}
	}

	for (const { numAwarded, numAwardedHardcore, entry } of byGameId.values()) {
		if (numAwarded === 0) continue
		db.insert(raGameProgress)
			.values({
				gameId: entry.gameId,
				title: entry.title,
				imageIcon: entry.imageIcon,
				numAchievements: entry.maxPossible,
				numAwarded,
				numAwardedHardcore,
				points: 0,
				maxPoints: 0,
				consoleId: entry.consoleId,
				consoleName: entry.consoleName,
				syncedAt: now,
			})
			.onConflictDoUpdate({
				target: raGameProgress.gameId,
				set: { numAwarded, numAwardedHardcore, syncedAt: now },
			})
			.run()
	}

	logger.info(`RA sync: upserted ${byGameId.size} game progress entries`)
}

export async function syncRetroAchievements(): Promise<void> {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled || !cfg.username || !cfg.apiKey) return

	logger.info('RA sync starting')
	try {
		await syncAllGameProgress()
		await syncRecentAchievements()
		purgeExpiredCache()
		logger.info('RA sync complete')
	} catch (err) {
		logger.error('RA sync failed', err)
		throw err
	}
}
