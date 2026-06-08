import { getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { gameIgdbMapping, games } from '@/lib/db/schema'
import type { IgdbCandidate } from '@/lib/igdb/match-game'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
	const system = req.nextUrl.searchParams.get('system')?.trim() || null

	const where = system
		? and(eq(gameIgdbMapping.needsReview, true), eq(games.system, system))
		: eq(gameIgdbMapping.needsReview, true)

	const rows = await db
		.select({
			gameId: gameIgdbMapping.gameId,
			gameName: games.name,
			system: games.system,
			igdbId: gameIgdbMapping.igdbId,
			igdbName: gameIgdbMapping.igdbName,
			confidence: gameIgdbMapping.matchConfidence,
			method: gameIgdbMapping.matchMethod,
			candidatesRaw: gameIgdbMapping.candidates,
		})
		.from(gameIgdbMapping)
		.innerJoin(games, eq(games.id, gameIgdbMapping.gameId))
		.where(where)
		.orderBy(desc(gameIgdbMapping.matchConfidence))
		.all()

	const items = rows.map(({ candidatesRaw, ...row }) => {
		let candidates: IgdbCandidate[] = []
		if (candidatesRaw) {
			try {
				const parsed = JSON.parse(candidatesRaw)
				if (Array.isArray(parsed)) {
					candidates = parsed as IgdbCandidate[]
				}
			} catch {
				console.error(`[igdb] Failed to parse candidates for game ${row.gameId}`)
			}
		}
		return { ...row, candidates }
	})

	return NextResponse.json({ items })
}
