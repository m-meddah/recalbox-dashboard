import { db } from '@/lib/db'
import { recommendationLog, sessions } from '@/lib/db/schema'
import { eq, gte, sql } from 'drizzle-orm'

export type QualityMetrics = {
	totalRecommendations: number
	totalLaunched: number
	totalSkipped: number
	totalIgnored: number

	launchRate: number
	skipRate: number
	hitRate: number
	bounceRate: number

	byMood: Record<string, { total: number; launchRate: number; hitRate: number }>
	byConfidence: Record<
		'high' | 'medium' | 'exploration',
		{ total: number; launchRate: number; hitRate: number }
	>

	windowDays: number
}

function windowStart(windowDays: number): Date {
	const d = new Date()
	d.setDate(d.getDate() - windowDays)
	return d
}

const isSignificant = (c: string | null) => c === 'meaningful' || c === 'marathon'
const isBounce = (c: string | null) => c === 'bounce'

export async function getQualityMetrics(windowDays = 30): Promise<QualityMetrics> {
	const rows = await db
		.select({
			mood: recommendationLog.contextMood,
			confidence: recommendationLog.confidence,
			launched: recommendationLog.launched,
			skipped: recommendationLog.skipped,
			sessionClassification: sessions.classification,
		})
		.from(recommendationLog)
		.leftJoin(sessions, eq(sessions.id, recommendationLog.resultingSessionId))
		.where(gte(recommendationLog.presentedAt, windowStart(windowDays)))
		.all()

	const total = rows.length
	const launched = rows.filter((r) => r.launched).length
	const skipped = rows.filter((r) => r.skipped).length
	const ignored = rows.filter((r) => !r.launched && !r.skipped).length

	const launchedRows = rows.filter((r) => r.launched && r.sessionClassification !== undefined)
	const significant = launchedRows.filter((r) =>
		isSignificant(r.sessionClassification ?? null),
	).length
	const bounces = launchedRows.filter((r) => isBounce(r.sessionClassification ?? null)).length

	const byMood: QualityMetrics['byMood'] = {}
	for (const mood of new Set(rows.map((r) => r.mood))) {
		const moodRows = rows.filter((r) => r.mood === mood)
		const moodLaunched = moodRows.filter((r) => r.launched)
		const moodSignificant = moodLaunched.filter((r) =>
			isSignificant(r.sessionClassification ?? null),
		)
		byMood[mood] = {
			total: moodRows.length,
			launchRate: moodRows.length ? moodLaunched.length / moodRows.length : 0,
			hitRate: moodLaunched.length ? moodSignificant.length / moodLaunched.length : 0,
		}
	}

	const byConfidence = {} as QualityMetrics['byConfidence']
	for (const conf of ['high', 'medium', 'exploration'] as const) {
		const confRows = rows.filter((r) => r.confidence === conf)
		const confLaunched = confRows.filter((r) => r.launched)
		const confSignificant = confLaunched.filter((r) =>
			isSignificant(r.sessionClassification ?? null),
		)
		byConfidence[conf] = {
			total: confRows.length,
			launchRate: confRows.length ? confLaunched.length / confRows.length : 0,
			hitRate: confLaunched.length ? confSignificant.length / confLaunched.length : 0,
		}
	}

	return {
		totalRecommendations: total,
		totalLaunched: launched,
		totalSkipped: skipped,
		totalIgnored: ignored,
		launchRate: total ? launched / total : 0,
		skipRate: total ? skipped / total : 0,
		hitRate: launched ? significant / launched : 0,
		bounceRate: launched ? bounces / launched : 0,
		byMood,
		byConfidence,
		windowDays,
	}
}

export async function getQualityTimeseries(
	windowDays = 30,
): Promise<Array<{ date: string; total: number; launched: number; hits: number }>> {
	const rows = await db
		.select({
			day: sql<string>`strftime('%Y-%m-%d', ${recommendationLog.presentedAt}, 'unixepoch')`,
			total: sql<number>`COUNT(*)`,
			launched: sql<number>`SUM(CASE WHEN ${recommendationLog.launched} THEN 1 ELSE 0 END)`,
			hits: sql<number>`SUM(CASE WHEN ${sessions.classification} IN ('meaningful', 'marathon') THEN 1 ELSE 0 END)`,
		})
		.from(recommendationLog)
		.leftJoin(sessions, eq(sessions.id, recommendationLog.resultingSessionId))
		.where(gte(recommendationLog.presentedAt, windowStart(windowDays)))
		.groupBy(sql`strftime('%Y-%m-%d', ${recommendationLog.presentedAt}, 'unixepoch')`)
		.orderBy(sql`strftime('%Y-%m-%d', ${recommendationLog.presentedAt}, 'unixepoch')`)
		.all()

	return rows.map((r) => ({
		date: r.day,
		total: Number(r.total),
		launched: Number(r.launched),
		hits: Number(r.hits),
	}))
}
