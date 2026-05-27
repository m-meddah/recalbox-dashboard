import { db } from '@/lib/db/index'
import { games, sessions } from '@/lib/db/schema'
import { desc, sql } from 'drizzle-orm'

export type WrappedPreview = {
	hours: number
	minutes: number
	topGame: string | null
}

export async function getWrappedPreview(year: number): Promise<WrappedPreview | null> {
	const yearStart = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000)
	const yearEnd = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000)

	const baseWhere = sql`
		${sessions.startedAt} >= ${yearStart}
		AND ${sessions.startedAt} < ${yearEnd}
		AND ${sessions.endedAt} IS NOT NULL
	`

	const [totalsRow, topGameRow] = await Promise.all([
		db
			.select({ totalSec: sql<number>`COALESCE(SUM(${sessions.durationSeconds}), 0)` })
			.from(sessions)
			.where(baseWhere)
			.get(),
		db
			.select({ gameName: sql<string>`COALESCE(${games.name}, ${sessions.romPath})` })
			.from(sessions)
			.leftJoin(games, sql`${sessions.romPath} = ${games.romPath}`)
			.where(baseWhere)
			.groupBy(sessions.romPath)
			.orderBy(desc(sql`SUM(${sessions.durationSeconds})`))
			.limit(1)
			.get(),
	])

	const totalSec = totalsRow?.totalSec ?? 0
	if (totalSec === 0) return null

	return {
		hours: Math.floor(totalSec / 3600),
		minutes: Math.floor((totalSec % 3600) / 60),
		topGame: topGameRow?.gameName ?? null,
	}
}
