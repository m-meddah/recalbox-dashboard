import { db } from '@/lib/db/index'
import { getSessionStats } from '@/lib/db/queries'
import { games, sessions } from '@/lib/db/schema'
import { desc, eq, sql } from 'drizzle-orm'
import { toDateKey } from './formatters'

export type Period = 'week' | 'month' | 'year' | 'all'

export type PeriodRange = { fromDate: Date; toDate: Date } | null

export type HeatmapCell = {
	date: Date
	dateKey: string
	playtimeSec: number
	sessionCount: number
	intensity: 0 | 1 | 2 | 3 | 4
}

export type RecentSession = {
	id: number
	gameName: string
	system: string
	startedAt: Date
	durationSec: number
}

export type KpiDelta = {
	value: number
	direction: 'up' | 'down' | 'neutral'
}

export type DashboardStats = {
	period: Period
	range: PeriodRange
	kpi: {
		totalPlaytimeSec: number
		uniqueGames: number
		totalSessions: number
		currentStreak: number
		longestStreak: number
		delta?: {
			playtime: KpiDelta
			sessions: KpiDelta
		}
	}
	playtimeByDay: Array<{ date: string; playtimeSec: number }>
	topGames: Array<{
		romPath: string
		gameName: string
		system: string
		playtimeSec: number
		sessionCount: number
		lastPlayed: Date
	}>
	bySystem: Array<{
		system: string
		playtimeSec: number
		sessionCount: number
		percentage: number
	}>
	recentSessions: RecentSession[]
	heatmap: HeatmapCell[][]
}

export function getPeriodRange(period: Period): PeriodRange {
	if (period === 'all') return null
	const toDate = new Date()
	const fromDate = new Date(toDate)
	if (period === 'week') fromDate.setDate(fromDate.getDate() - 7)
	else if (period === 'month') fromDate.setDate(fromDate.getDate() - 30)
	else fromDate.setDate(fromDate.getDate() - 365)
	return { fromDate, toDate }
}

function getPreviousPeriodRange(period: Period): PeriodRange {
	if (period === 'all') return null
	const range = getPeriodRange(period)
	if (!range) return null
	const duration = range.toDate.getTime() - range.fromDate.getTime()
	return {
		fromDate: new Date(range.fromDate.getTime() - duration),
		toDate: new Date(range.fromDate),
	}
}

function makeDelta(current: number, previous: number): KpiDelta {
	if (previous === 0) return { value: 0, direction: 'neutral' }
	const pct = Math.round(((current - previous) / previous) * 100)
	return {
		value: Math.abs(pct),
		direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
	}
}

export function generateHeatmap(
	playtimeByDay: Array<{ date: string; playtimeSec: number; sessionCount?: number }>,
	endDate: Date = new Date(),
	daysBack = 365,
): HeatmapCell[][] {
	const lookup = new Map<string, { playtimeSec: number; sessionCount: number }>()
	for (const d of playtimeByDay) {
		lookup.set(d.date, { playtimeSec: d.playtimeSec, sessionCount: d.sessionCount ?? 0 })
	}

	const nonZero = playtimeByDay
		.filter((d) => d.playtimeSec > 0)
		.map((d) => d.playtimeSec)
		.sort((a, b) => a - b)
	const q1 = nonZero[Math.floor(nonZero.length * 0.25)] ?? 0
	const q2 = nonZero[Math.floor(nonZero.length * 0.5)] ?? 0
	const q3 = nonZero[Math.floor(nonZero.length * 0.75)] ?? 0

	function intensity(sec: number): 0 | 1 | 2 | 3 | 4 {
		if (sec <= 0) return 0
		if (nonZero.length === 0) return 0
		if (sec <= q1) return 1
		if (sec <= q2) return 2
		if (sec <= q3) return 3
		return 4
	}

	const end = new Date(endDate)
	end.setHours(23, 59, 59, 999)
	const start = new Date(end)
	start.setDate(start.getDate() - daysBack)
	start.setDate(start.getDate() - start.getDay()) // rewind to Sunday

	const weeks: HeatmapCell[][] = []
	const cur = new Date(start)

	while (cur <= end) {
		const week: HeatmapCell[] = []
		for (let d = 0; d < 7; d++) {
			const dateKey = toDateKey(cur)
			const data = lookup.get(dateKey) ?? { playtimeSec: 0, sessionCount: 0 }
			week.push({
				date: new Date(cur),
				dateKey,
				playtimeSec: data.playtimeSec,
				sessionCount: data.sessionCount,
				intensity: intensity(data.playtimeSec),
			})
			cur.setDate(cur.getDate() + 1)
		}
		weeks.push(week)
	}

	return weeks
}

function calculateStreaks(byDay: Array<{ date: string; playtimeSec: number }>) {
	const MIN_SEC = 60
	const activeSet = new Set(byDay.filter((d) => d.playtimeSec >= MIN_SEC).map((d) => d.date))

	const todayKey = toDateKey(new Date())
	const yesterdayKey = toDateKey(new Date(Date.now() - 86400000))

	let currentStreak = 0
	if (activeSet.has(todayKey) || activeSet.has(yesterdayKey)) {
		const startDay = activeSet.has(todayKey) ? new Date() : new Date(Date.now() - 86400000)
		const d = new Date(startDay)
		while (activeSet.has(toDateKey(d))) {
			currentStreak++
			d.setDate(d.getDate() - 1)
		}
	}

	const sortedDates = [...activeSet].sort()
	let longestStreak = 0
	let run = 0
	let prev: Date | null = null

	for (const ds of sortedDates) {
		const date = new Date(`${ds}T12:00:00Z`)
		if (prev) {
			const diffDays = Math.round((date.getTime() - prev.getTime()) / 86400000)
			run = diffDays === 1 ? run + 1 : 1
		} else {
			run = 1
		}
		longestStreak = Math.max(longestStreak, run)
		prev = date
	}

	return { currentStreak, longestStreak }
}

async function getRecentSessionsWithNames(): Promise<RecentSession[]> {
	const rows = await db
		.select({
			id: sessions.id,
			gameName: sql<string>`COALESCE(${games.name}, ${sessions.romPath})`,
			system: sessions.system,
			startedAt: sessions.startedAt,
			durationSeconds: sessions.durationSeconds,
		})
		.from(sessions)
		.leftJoin(games, eq(sessions.romPath, games.romPath))
		.where(sql`${sessions.endedAt} IS NOT NULL`)
		.orderBy(desc(sessions.startedAt))
		.limit(20)

	return rows.map((r) => ({
		id: r.id,
		gameName: r.gameName,
		system: r.system,
		startedAt: r.startedAt,
		durationSec: r.durationSeconds ?? 0,
	}))
}

export async function getDashboardStats(period: Period): Promise<DashboardStats> {
	const range = getPeriodRange(period)
	const prevRange = getPreviousPeriodRange(period)

	const [periodStats, prevStats, allTimeStats, recentSessions] = await Promise.all([
		getSessionStats({ fromDate: range?.fromDate, toDate: range?.toDate, topGamesLimit: 50 }),
		prevRange
			? getSessionStats({ fromDate: prevRange.fromDate, toDate: prevRange.toDate })
			: Promise.resolve(null),
		period !== 'all' ? getSessionStats({}) : Promise.resolve(null),
		getRecentSessionsWithNames(),
	])

	const streakByDay = allTimeStats?.byDay ?? periodStats.byDay
	const { currentStreak, longestStreak } = calculateStreaks(streakByDay)
	const heatmapByDay = allTimeStats?.byDay ?? periodStats.byDay

	const totalPlaytime = periodStats.bySystem.reduce((s, r) => s + r.playtimeSec, 0)
	const bySystem = periodStats.bySystem.map((s) => ({
		...s,
		percentage: totalPlaytime > 0 ? Math.round((s.playtimeSec / totalPlaytime) * 100) : 0,
	}))

	const delta =
		prevStats !== null
			? {
					playtime: makeDelta(periodStats.totalPlaytimeSec, prevStats.totalPlaytimeSec),
					sessions: makeDelta(periodStats.totalSessions, prevStats.totalSessions),
				}
			: undefined

	return {
		period,
		range,
		kpi: {
			totalPlaytimeSec: periodStats.totalPlaytimeSec,
			uniqueGames: periodStats.uniqueGames,
			totalSessions: periodStats.totalSessions,
			currentStreak,
			longestStreak,
			delta,
		},
		playtimeByDay: periodStats.byDay,
		topGames: periodStats.topGames,
		bySystem,
		recentSessions,
		heatmap: generateHeatmap(heatmapByDay),
	}
}
