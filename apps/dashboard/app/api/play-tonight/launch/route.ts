import { db } from '@/lib/db'
import { recommendationLog } from '@/lib/db/schema'
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
