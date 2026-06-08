import { getUser, unauthorized } from '@/lib/auth/require-user'
import { feedbackService } from '@/lib/feedback/service'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({ feedbackId: z.number().int().positive() })

export async function POST(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
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

	await feedbackService.dismiss(parsed.data.feedbackId)
	return NextResponse.json({ ok: true })
}
