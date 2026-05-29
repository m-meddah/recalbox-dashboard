import { NextRequest, NextResponse } from 'next/server'
import { recommend } from '@/lib/recommendations/recommend'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const Schema = z.object({
	availableMinutes: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(240)]),
	mood: z.enum(['chill', 'challenge', 'nostalgia', 'discovery', 'finish', 'surprise']),
})

export async function POST(req: NextRequest) {
	const parsed = Schema.safeParse(await req.json())
	if (!parsed.success) return NextResponse.json({ error: parsed.error.format() }, { status: 400 })

	try {
		const recommendations = await recommend(parsed.data)
		return NextResponse.json({ recommendations })
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : 'unknown error'
		console.error('[recommend] failed:', e)
		return NextResponse.json({ error: 'recommendation_failed', message }, { status: 500 })
	}
}
