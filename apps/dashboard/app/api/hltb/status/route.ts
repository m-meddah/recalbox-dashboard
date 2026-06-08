import { getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { gameHltbMapping, games } from '@/lib/db/schema'
import { eq, isNotNull, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
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
