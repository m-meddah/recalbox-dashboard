import { db } from '@/lib/db'
import { gameIgdbMapping } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Schema = z.object({
	gameId: z.number().int(),
	action: z.enum(['confirm', 'reject', 'manual']),
	igdbId: z.number().int().optional(),
	igdbName: z.string().optional(),
})

export async function POST(req: NextRequest) {
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
	}

	const parsed = Schema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 422 })
	}

	const { gameId, action, igdbId, igdbName } = parsed.data

	if (action === 'confirm') {
		await db
			.update(gameIgdbMapping)
			.set({ needsReview: false, matchConfidence: 1.0, matchMethod: 'manual' })
			.where(eq(gameIgdbMapping.gameId, gameId))
	} else if (action === 'reject') {
		await db
			.update(gameIgdbMapping)
			.set({
				igdbId: null,
				igdbName: null,
				needsReview: false,
				matchMethod: 'not_found',
				matchConfidence: 0,
			})
			.where(eq(gameIgdbMapping.gameId, gameId))
	} else if (action === 'manual' && igdbId != null && igdbName != null) {
		await db
			.update(gameIgdbMapping)
			.set({ igdbId, igdbName, needsReview: false, matchMethod: 'manual', matchConfidence: 1.0 })
			.where(eq(gameIgdbMapping.gameId, gameId))
	}

	return NextResponse.json({ ok: true })
}
