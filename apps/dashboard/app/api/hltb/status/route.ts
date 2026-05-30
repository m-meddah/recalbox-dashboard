import { db } from '@/lib/db'
import { games, gameHltbMapping } from '@/lib/db/schema'
import { eq, isNotNull, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const [totalGames, mapped, notFound] = await Promise.all([
		db.select({ id: games.id }).from(games).where(eq(games.hidden, false)).all(),
		db
			.select({ gameId: gameHltbMapping.gameId })
			.from(gameHltbMapping)
			.where(isNotNull(gameHltbMapping.hltbId))
			.all(),
		db
			.select({ gameId: gameHltbMapping.gameId })
			.from(gameHltbMapping)
			.where(isNull(gameHltbMapping.hltbId))
			.all(),
	])

	return NextResponse.json({
		totalGames: totalGames.length,
		matched: mapped.length,
		notFound: notFound.length,
		unmapped: totalGames.length - mapped.length - notFound.length,
	})
}
