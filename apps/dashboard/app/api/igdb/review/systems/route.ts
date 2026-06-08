import { getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { gameIgdbMapping, games } from '@/lib/db/schema'
import { desc, eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	const rows = await db
		.select({
			system: games.system,
			count: sql<number>`count(*)`.as('count'),
		})
		.from(gameIgdbMapping)
		.innerJoin(games, eq(games.id, gameIgdbMapping.gameId))
		.where(eq(gameIgdbMapping.needsReview, true))
		.groupBy(games.system)
		.orderBy(desc(sql`count(*)`))

		.all()

	return NextResponse.json({ systems: rows })
}
