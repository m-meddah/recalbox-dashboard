import { db } from '@/lib/db'
import { raAchievements, raGameProgress } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import {
	getAchievementsEarnedBetween,
	getUserCompletedGames,
	getUserProfile,
	getUserRecentAchievements,
} from '@retroachievements/api'
import { desc, eq } from 'drizzle-orm'
import { getAuth } from './auth'
import { getCached, getTtlSeconds, setCached } from './cache'
import { withRateLimit } from './rate-limiter'

export type RaProfile = {
	user: string
	userPic: string
	totalPoints: number
	totalSoftcorePoints: number
	totalTruePoints: number
	motto: string
	memberSince: string
	richPresenceMsg: string
	lastGameId: number
}

export type RaAchievement = {
	achievementId: number
	title: string
	description: string
	points: number
	badgeUrl: string
	gameId: number
	gameTitle: string
	consoleName: string
	unlockedAt: string
	hardcoreMode: boolean
}

export type RaGameProgress = {
	gameId: number
	title: string
	imageIcon: string
	numAchievements: number
	numAwarded: number
	numAwardedHardcore: number
	points: number
	maxPoints: number
	consoleId: number
	consoleName: string
	completionPct: number
}

export async function getProfile(): Promise<RaProfile> {
	const cacheKey = `profile:${getAuth().username}`
	const cached = getCached<RaProfile>(cacheKey)
	if (cached) return cached

	const raw = await withRateLimit(() =>
		getUserProfile(getAuth(), { username: getAuth().username }),
	)

	const profile: RaProfile = {
		user: raw.user,
		userPic: raw.userPic,
		totalPoints: raw.totalPoints,
		totalSoftcorePoints: raw.totalSoftcorePoints,
		totalTruePoints: raw.totalTruePoints,
		motto: raw.motto,
		memberSince: raw.memberSince,
		richPresenceMsg: raw.richPresenceMsg,
		lastGameId: raw.lastGameId,
	}

	setCached(cacheKey, profile, getTtlSeconds('userProfile'))
	return profile
}

export async function getRecentAchievements(count = 20): Promise<RaAchievement[]> {
	const { username } = getAuth()
	const cacheKey = `recent-year:${username}`
	const cached = getCached<RaAchievement[]>(cacheKey)
	if (cached) return cached.slice(0, count)

	const toDate = new Date()
	const fromDate = new Date(toDate)
	fromDate.setFullYear(fromDate.getFullYear() - 1)

	const raw = await withRateLimit(() =>
		getAchievementsEarnedBetween(getAuth(), { username, fromDate, toDate }),
	)

	const achievements = raw.map((a) => ({
		achievementId: a.achievementId,
		title: a.title,
		description: a.description,
		points: a.points,
		badgeUrl: `https://media.retroachievements.org/Badge/${a.badgeName}.png`,
		gameId: a.gameId,
		gameTitle: a.gameTitle,
		consoleName: a.consoleName,
		unlockedAt: a.date,
		hardcoreMode: a.hardcoreMode,
	}))

	setCached(cacheKey, achievements, getTtlSeconds('recentAchievements'))
	return achievements.slice(0, count)
}

export async function getYearAchievements(): Promise<RaAchievement[]> {
	const { username } = getAuth()
	const cacheKey = `recent-year:${username}`
	const cached = getCached<RaAchievement[]>(cacheKey)
	if (cached) return cached

	const toDate = new Date()
	const fromDate = new Date(toDate)
	fromDate.setFullYear(fromDate.getFullYear() - 1)

	const raw = await withRateLimit(() =>
		getAchievementsEarnedBetween(getAuth(), { username, fromDate, toDate }),
	)

	const achievements = raw.map((a) => ({
		achievementId: a.achievementId,
		title: a.title,
		description: a.description,
		points: a.points,
		badgeUrl: `https://media.retroachievements.org/Badge/${a.badgeName}.png`,
		gameId: a.gameId,
		gameTitle: a.gameTitle,
		consoleName: a.consoleName,
		unlockedAt: a.date,
		hardcoreMode: a.hardcoreMode,
	}))

	setCached(cacheKey, achievements, getTtlSeconds('recentAchievements'))
	return achievements
}

export async function getAllGameProgress(): Promise<RaGameProgress[]> {
	const rows = db
		.select()
		.from(raGameProgress)
		.orderBy(desc(raGameProgress.numAwarded))
		.all()

	return rows.map((r) => ({
		gameId: r.gameId,
		title: r.title,
		imageIcon: r.imageIcon,
		numAchievements: r.numAchievements,
		numAwarded: r.numAwarded,
		numAwardedHardcore: r.numAwardedHardcore,
		points: r.points,
		maxPoints: r.maxPoints,
		consoleId: r.consoleId,
		consoleName: r.consoleName,
		completionPct: r.numAchievements > 0 ? (r.numAwarded / r.numAchievements) * 100 : 0,
	}))
}

export async function getLiveGameProgress(): Promise<RaGameProgress[]> {
	const { username } = getAuth()
	const cacheKey = `live-progress:${username}`
	const cached = getCached<RaGameProgress[]>(cacheKey)
	if (cached) return cached

	const raw = await withRateLimit(() =>
		getUserCompletedGames(getAuth(), { username }),
	)

	const byGameId = new Map<number, RaGameProgress>()
	for (const entry of raw) {
		const existing = byGameId.get(entry.gameId)
		if (!existing || entry.numAwarded > existing.numAwarded) {
			byGameId.set(entry.gameId, {
				gameId: entry.gameId,
				title: entry.title,
				imageIcon: entry.imageIcon,
				numAchievements: entry.maxPossible,
				numAwarded: entry.numAwarded,
				numAwardedHardcore: entry.hardcoreMode ? entry.numAwarded : 0,
				points: 0,
				maxPoints: 0,
				consoleId: entry.consoleId,
				consoleName: entry.consoleName,
				completionPct: entry.maxPossible > 0 ? (entry.numAwarded / entry.maxPossible) * 100 : 0,
			})
		}
	}

	const progress = [...byGameId.values()]
		.filter((g) => g.numAwarded > 0)
		.sort((a, b) => b.numAwarded - a.numAwarded)

	setCached(cacheKey, progress, getTtlSeconds('gameProgress'))
	return progress
}

export async function getGameProgress(gameId: number): Promise<RaGameProgress | null> {
	const row = db.select().from(raGameProgress).where(eq(raGameProgress.gameId, gameId)).get()
	if (!row) return null
	return {
		gameId: row.gameId,
		title: row.title,
		imageIcon: row.imageIcon,
		numAchievements: row.numAchievements,
		numAwarded: row.numAwarded,
		numAwardedHardcore: row.numAwardedHardcore,
		points: row.points,
		maxPoints: row.maxPoints,
		consoleId: row.consoleId,
		consoleName: row.consoleName,
		completionPct: row.numAchievements > 0 ? (row.numAwarded / row.numAchievements) * 100 : 0,
	}
}

export async function getRecentAchievementsFromDb(limit = 20): Promise<typeof raAchievements.$inferSelect[]> {
	return db
		.select()
		.from(raAchievements)
		.orderBy(desc(raAchievements.unlockedAt))
		.limit(limit)
		.all()
}

export async function getUnlockedGameIds(): Promise<Set<number>> {
	const rows = db
		.selectDistinct({ gameId: raAchievements.gameId })
		.from(raAchievements)
		.all()
	return new Set(rows.map((r) => r.gameId))
}

export async function testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
	try {
		const profile = await withRateLimit(() =>
			getUserProfile(getAuth(), { username: getAuth().username }),
		)
		return { ok: true, user: profile.user }
	} catch (err) {
		logger.warn('RA connection test failed', err)
		return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
	}
}
