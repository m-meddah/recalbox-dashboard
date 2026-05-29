import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recommendationSkip, recommendationLog } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const SKIP_DAYS = 7
const Schema = z.object({ gameId: z.number().int() })

export async function POST(req: NextRequest) {
	const { gameId } = Schema.parse(await req.json())
	const expiresAt = new Date()
	expiresAt.setDate(expiresAt.getDate() + SKIP_DAYS)

	await db
		.insert(recommendationSkip)
		.values({ gameId, expiresAt })
		.onConflictDoUpdate({
			target: recommendationSkip.gameId,
			set: { skippedAt: new Date(), expiresAt },
		})

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
			.set({ skipped: true, skippedAt: new Date() })
			.where(eq(recommendationLog.id, latest.id))
	}

	return NextResponse.json({ ok: true })
}
