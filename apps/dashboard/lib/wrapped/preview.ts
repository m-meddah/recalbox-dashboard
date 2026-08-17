import { db } from '@/lib/db/index'
import { games, sessions } from '@/lib/db/schema'
import { desc, inArray, sql } from 'drizzle-orm'

export type WrappedPreview = {
	hours: number
	minutes: number
	topGame: string | null
}

/**
 * @param recalboxIds the boxes the viewer may see (`getViewableRecalboxIds`). Empty means
 * "no box", hence no preview — never "every box", which would show another user's year.
 */
export async function getWrappedPreview(
	year: number,
	recalboxIds: string[],
): Promise<WrappedPreview | null> {
	if (recalboxIds.length === 0) return null

	const yearStart = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000)
	const yearEnd = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000)

	const baseWhere = sql`
		${sessions.startedAt} >= ${yearStart}
		AND ${sessions.startedAt} < ${yearEnd}
		AND ${sessions.endedAt} IS NOT NULL
		AND ${inArray(sessions.recalboxId, recalboxIds)}
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
			// Match the game row on the SAME box. Rom paths repeat across Recalboxes —
			// retro collections overlap heavily — so joining on rom_path alone matches one
			// row per box and the LEFT JOIN emits the session once per match. That inflates
			// SUM(duration) and can crown a game nobody played the most.
			.leftJoin(
				games,
				sql`${sessions.romPath} = ${games.romPath} AND ${sessions.recalboxId} = ${games.recalboxId}`,
			)
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
