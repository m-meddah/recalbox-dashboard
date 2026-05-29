import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recommendationLog } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const Schema = z.object({ gameId: z.number().int() })

export async function POST(req: NextRequest) {
	const { gameId } = Schema.parse(await req.json())

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

	return NextResponse.json({ ok: true })
}
