import { db } from '@/lib/db'
import { games, recommendationLog } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { launchGame } from '@/lib/recalbox/launch-game'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const Schema = z.object({ gameId: z.number().int() })

export async function POST(req: NextRequest) {
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}
	const parsed = Schema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	}
	const { gameId } = parsed.data

	// Record the choice so the recommender learns from it.
	const latest = await db
		.select()
		.from(recommendationLog)
		.where(
			and(
				eq(recommendationLog.gameId, gameId),
				eq(recommendationLog.launched, false),
				eq(recommendationLog.skipped, false),
			),
		)
		.orderBy(desc(recommendationLog.presentedAt))
		.limit(1)
		.get()

	if (latest) {
		await db
			.update(recommendationLog)
			.set({ launched: true, launchedAt: new Date() })
			.where(eq(recommendationLog.id, latest.id))
	}

	// Actually start the game on the active Recalbox (the box the dashboard drives).
	let launched = false
	try {
		const recalboxId = await getActiveRecalboxId()
		const game = await db
			.select({ romPath: games.romPath, system: games.system })
			.from(games)
			.where(eq(games.id, gameId))
			.get()

		if (recalboxId && game) {
			await launchGame(recalboxId, game.system, game.romPath)
			launched = true
		}
	} catch (err) {
		// The choice is logged regardless; surface the launch failure to the client.
		logger.error('Play-tonight game launch failed', err)
	}

	return NextResponse.json({ ok: true, launched })
}
