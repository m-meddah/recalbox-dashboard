import { db } from '@/lib/db'
import { gameIgdbMapping, games } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const items = await db
		.select({
			gameId: gameIgdbMapping.gameId,
			gameName: games.name,
			system: games.system,
			igdbId: gameIgdbMapping.igdbId,
			igdbName: gameIgdbMapping.igdbName,
			confidence: gameIgdbMapping.matchConfidence,
			method: gameIgdbMapping.matchMethod,
		})
		.from(gameIgdbMapping)
		.innerJoin(games, eq(games.id, gameIgdbMapping.gameId))
		.where(eq(gameIgdbMapping.needsReview, true))
		.orderBy(desc(gameIgdbMapping.matchConfidence))
		.all()

	return NextResponse.json({ items })
}
