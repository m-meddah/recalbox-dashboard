import { feedbackService } from '@/lib/feedback/service'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
	feedbackId: z.number().int().positive(),
	response: z.enum([
		'not_for_me',
		'come_back_later',
		'good_but_timing',
		'meh',
		'mixed',
		'want_more',
		'so_so',
		'good',
		'excellent',
		'memorable',
		'dismiss',
	]),
})

export async function POST(req: NextRequest) {
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}

	const parsed = schema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
	}

	const { feedbackId, response } = parsed.data

	try {
		const { ratingApplied } = await feedbackService.respond(feedbackId, response)
		return NextResponse.json({ ok: true, ratingApplied })
	} catch (err) {
		if (err instanceof Error && err.message === 'Feedback not found') {
			return NextResponse.json({ error: 'Feedback not found' }, { status: 404 })
		}
		throw err
	}
}
