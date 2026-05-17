import { db } from '@/lib/db/index'
import { games, raAchievements, sessions } from '@/lib/db/schema'
import { configStore } from '@/lib/config-store'
import { asc, desc, sql } from 'drizzle-orm'
import { computeUnlocks } from './unlocks'
import type {
	WrappedRawData,
	Wrapped,
	WrappedSlide,
	WrappedUnlock,
	TotalTimeSlide,
	MostPlayedGameSlide,
	TopSystemSlide,
	TopGamesListSlide,
	LongestSessionSlide,
	BusiestDaySlide,
	StreakSlide,
	AchievementsSummarySlide,
	UnlocksSlide,
	ComparisonSlide,
	OutroSlide,
} from './types'

// Estimated averages — no user tracking
const PERCENTILE_THRESHOLDS = [
	{ minHours: 500, percentile: 1 },
	{ minHours: 200, percentile: 5 },
	{ minHours: 100, percentile: 15 },
	{ minHours: 50,  percentile: 30 },
	{ minHours: 25,  percentile: 50 },
] as const

const AVERAGE_HOURS_PER_YEAR = 40

function computePercentile(totalHours: number): number {
	for (const { minHours, percentile } of PERCENTILE_THRESHOLDS) {
		if (totalHours >= minHours) return percentile
	}
	return 75
}

export function buildSlides(data: WrappedRawData, unlocks: WrappedUnlock[]): WrappedSlide[] {
	const slides: WrappedSlide[] = [{ type: 'intro' }]
	const total = data.totalDurationSec
	const totalHours = Math.floor(total / 3600)

	if (total > 0) {
		const totalTimeSlide: TotalTimeSlide = {
			type: 'total-time',
			totalHours,
			totalSessions: data.totalSessions,
			comparisonMovies: Math.round(totalHours * 60 / 120),
		}
		slides.push(totalTimeSlide)
	}

	if (data.topGames.length > 0) {
		const g = data.topGames[0]!
		const slide: MostPlayedGameSlide = {
			type: 'most-played-game',
			gameName: g.gameName,
			system: g.system,
			playtimeHours: Math.floor(g.playtimeSec / 3600),
			sessionCount: g.sessionCount,
			imagePath: g.imagePath,
		}
		slides.push(slide)
	}

	if (data.bySystem.length > 0 && total > 0) {
		const top = data.bySystem[0]!
		const slide: TopSystemSlide = {
			type: 'top-system',
			system: top.system,
			percentage: Math.round((top.playtimeSec / total) * 100),
			breakdown: data.bySystem.map((s) => ({
				system: s.system,
				playtimeSec: s.playtimeSec,
				percentage: Math.round((s.playtimeSec / total) * 100),
			})),
		}
		slides.push(slide)
	}

	if (data.topGames.length >= 2) {
		const slide: TopGamesListSlide = {
			type: 'top-games-list',
			games: data.topGames.slice(0, 5).map((g, i) => ({
				gameName: g.gameName,
				system: g.system,
				playtimeHours: Math.floor(g.playtimeSec / 3600),
				rank: i + 1,
			})),
		}
		slides.push(slide)
	}

	if (data.longestSession) {
		const { gameName, durationSec, startedAt } = data.longestSession
		const slide: LongestSessionSlide = {
			type: 'longest-session',
			gameName,
			durationHours: Math.floor(durationSec / 3600),
			durationMinutes: Math.floor((durationSec % 3600) / 60),
			dateStr: startedAt.toISOString().slice(0, 10),
		}
		slides.push(slide)
	}

	if (data.busiestDay) {
		const slide: BusiestDaySlide = {
			type: 'busiest-day',
			dateStr: data.busiestDay.dateStr,
			totalHours: Math.floor(data.busiestDay.totalSec / 3600),
			sessionCount: data.busiestDay.sessionCount,
		}
		slides.push(slide)
	}

	if (data.activeDays.length >= 2) {
		let longestStreak = 0
		let run = 0
		let prev: Date | null = null
		for (const day of data.activeDays) {
			const date = new Date(day + 'T12:00:00Z')
			if (prev) {
				const diff = Math.round((date.getTime() - prev.getTime()) / 86400000)
				run = diff === 1 ? run + 1 : 1
			} else {
				run = 1
			}
			longestStreak = Math.max(longestStreak, run)
			prev = date
		}
		const slide: StreakSlide = {
			type: 'streak',
			longestStreak,
			activeDays: data.activeDays,
		}
		slides.push(slide)
	}

	if (data.raAchievements !== null && data.raAchievements.length > 0) {
		const sorted = [...data.raAchievements].sort((a, b) => a.points - b.points)
		const slide: AchievementsSummarySlide = {
			type: 'achievements-summary',
			totalUnlocked: data.raAchievements.length,
			totalPoints: data.raAchievements.reduce((s, a) => s + a.points, 0),
			rarestAchievement: sorted[0]
				? { title: sorted[0].title, points: sorted[0].points, imageUrl: sorted[0].imageUrl }
				: null,
		}
		slides.push(slide)
	}

	if (unlocks.length > 0) {
		const slide: UnlocksSlide = { type: 'unlocks', unlocks }
		slides.push(slide)
	}

	if (total > 0) {
		const slide: ComparisonSlide = {
			type: 'comparison-vs-others',
			percentile: computePercentile(totalHours),
			totalHours,
			averageHours: AVERAGE_HOURS_PER_YEAR,
		}
		slides.push(slide)
	}

	const outro: OutroSlide = { type: 'outro', year: data.year, totalHours }
	slides.push(outro)

	return slides
}

export async function fetchWrappedRawData(year: number): Promise<WrappedRawData> {
	const yearStart = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000)
	const yearEnd = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000)
	const twentyYearsAgo = Math.floor(new Date(`${year - 20}-01-01T00:00:00Z`).getTime() / 1000)

	const baseWhere = sql`
		${sessions.startedAt} >= ${yearStart}
		AND ${sessions.startedAt} < ${yearEnd}
		AND ${sessions.endedAt} IS NOT NULL
	`

	const [
		totalsRow,
		topGamesRows,
		bySystemRows,
		longestSessionRow,
		busiestDayRow,
		activeDaysRows,
		shortSessionRow,
		nightPlayRow,
		earlyBirdRow,
		weekendRow,
		throwbackRow,
		raRows,
	] = await Promise.all([
		db
			.select({
				totalSessions: sql<number>`COUNT(*)`,
				totalDurationSec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)`,
				uniqueGamesCount: sql<number>`COUNT(DISTINCT ${sessions.romPath})`,
				uniqueSystemsCount: sql<number>`COUNT(DISTINCT ${sessions.system})`,
			})
			.from(sessions)
			.where(baseWhere)
			.get(),

		db
			.select({
				gameName: sql<string>`COALESCE(${games.name}, ${sessions.romPath})`,
				system: sessions.system,
				playtimeSec: sql<number>`SUM(${sessions.durationSeconds})`,
				sessionCount: sql<number>`COUNT(*)`,
				imagePath: games.imagePath,
			})
			.from(sessions)
			.leftJoin(games, sql`${sessions.romPath} = ${games.romPath}`)
			.where(baseWhere)
			.groupBy(sessions.romPath)
			.orderBy(desc(sql`SUM(${sessions.durationSeconds})`))
			.limit(5),

		db
			.select({
				system: sessions.system,
				playtimeSec: sql<number>`SUM(${sessions.durationSeconds})`,
			})
			.from(sessions)
			.where(baseWhere)
			.groupBy(sessions.system)
			.orderBy(desc(sql`SUM(${sessions.durationSeconds})`)),

		db
			.select({
				gameName: sql<string>`COALESCE(${games.name}, ${sessions.romPath})`,
				durationSec: sessions.durationSeconds,
				startedAt: sessions.startedAt,
			})
			.from(sessions)
			.leftJoin(games, sql`${sessions.romPath} = ${games.romPath}`)
			.where(baseWhere)
			.orderBy(desc(sessions.durationSeconds))
			.limit(1)
			.get(),

		db
			.select({
				dateStr: sql<string>`date(${sessions.startedAt}, 'unixepoch')`,
				totalSec: sql<number>`SUM(${sessions.durationSeconds})`,
				sessionCount: sql<number>`COUNT(*)`,
			})
			.from(sessions)
			.where(baseWhere)
			.groupBy(sql`date(${sessions.startedAt}, 'unixepoch')`)
			.orderBy(desc(sql`SUM(${sessions.durationSeconds})`))
			.limit(1)
			.get(),

		db
			.select({
				day: sql<string>`date(${sessions.startedAt}, 'unixepoch')`,
			})
			.from(sessions)
			.where(baseWhere)
			.groupBy(sql`date(${sessions.startedAt}, 'unixepoch')`)
			.orderBy(asc(sql`date(${sessions.startedAt}, 'unixepoch')`)),

		db
			.select({ cnt: sql<number>`COUNT(*)` })
			.from(sessions)
			.where(sql`${baseWhere} AND ${sessions.durationSeconds} < 900`)
			.get(),

		db
			.select({ sec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)` })
			.from(sessions)
			.where(
				sql`${baseWhere} AND CAST(strftime('%H', datetime(${sessions.startedAt}, 'unixepoch', 'localtime')) AS INTEGER) BETWEEN 0 AND 3`,
			)
			.get(),

		db
			.select({ sec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)` })
			.from(sessions)
			.where(
				sql`${baseWhere} AND CAST(strftime('%H', datetime(${sessions.startedAt}, 'unixepoch', 'localtime')) AS INTEGER) BETWEEN 5 AND 8`,
			)
			.get(),

		db
			.select({ sec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)` })
			.from(sessions)
			.where(
				sql`${baseWhere} AND strftime('%w', datetime(${sessions.startedAt}, 'unixepoch')) IN ('0', '6')`,
			)
			.get(),

		db
			.select({ sec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)` })
			.from(sessions)
			.leftJoin(games, sql`${sessions.romPath} = ${games.romPath}`)
			.where(
				sql`${baseWhere} AND ${games.releaseDate} IS NOT NULL AND ${games.releaseDate} < ${twentyYearsAgo}`,
			)
			.get(),

		(async () => {
			const cfg = configStore.get()
			if (!cfg.retroachievements.enabled) return null
			return db
				.select({
					title: raAchievements.title,
					points: raAchievements.points,
					imageUrl: raAchievements.imageUrl,
					isHardcore: sql<boolean>`COALESCE(${raAchievements.isHardcore}, false)`,
				})
				.from(raAchievements)
				.where(
					sql`${raAchievements.unlockedAt} >= ${yearStart} AND ${raAchievements.unlockedAt} < ${yearEnd}`,
				)
		})(),
	])

	const cfg = configStore.get()

	return {
		year,
		totalSessions: totalsRow?.totalSessions ?? 0,
		totalDurationSec: totalsRow?.totalDurationSec ?? 0,
		uniqueGamesCount: totalsRow?.uniqueGamesCount ?? 0,
		uniqueSystemsCount: totalsRow?.uniqueSystemsCount ?? 0,
		topGames: topGamesRows.map((r) => ({
			gameName: r.gameName,
			system: r.system,
			playtimeSec: r.playtimeSec,
			sessionCount: r.sessionCount,
			imagePath: r.imagePath ?? null,
		})),
		bySystem: bySystemRows,
		longestSession: longestSessionRow
			? {
					gameName: longestSessionRow.gameName,
					durationSec: longestSessionRow.durationSec ?? 0,
					startedAt:
						longestSessionRow.startedAt instanceof Date
							? longestSessionRow.startedAt
							: new Date((longestSessionRow.startedAt as number) * 1000),
				}
			: null,
		busiestDay: busiestDayRow
			? {
					dateStr: busiestDayRow.dateStr,
					totalSec: busiestDayRow.totalSec,
					sessionCount: busiestDayRow.sessionCount,
				}
			: null,
		activeDays: activeDaysRows.map((r) => r.day),
		shortSessionCount: shortSessionRow?.cnt ?? 0,
		nightPlaySec: nightPlayRow?.sec ?? 0,
		earlyBirdSec: earlyBirdRow?.sec ?? 0,
		weekendSec: weekendRow?.sec ?? 0,
		throwbackGameSec: throwbackRow?.sec ?? 0,
		raAchievements: raRows,
		userPseudo: cfg.retroachievements.username || undefined,
	}
}

export async function generateWrapped(year: number, locale: string): Promise<Wrapped> {
	const rawData = await fetchWrappedRawData(year)
	const unlocks = computeUnlocks(rawData)
	const slides = buildSlides(rawData, unlocks)

	return {
		year,
		generatedAt: new Date(),
		user: { pseudo: rawData.userPseudo },
		slides,
		unlocks,
	}
}
