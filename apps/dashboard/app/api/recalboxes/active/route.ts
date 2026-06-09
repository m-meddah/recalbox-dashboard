import { canViewRecalbox } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { setActiveRecalboxId } from '@/lib/recalbox/active'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({ id: z.uuid() })

export async function PUT(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}
	const parsed = bodySchema.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: 'Invalid id' }, { status: 422 })
	if (!canViewRecalbox(user, parsed.data.id))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })
	await setActiveRecalboxId(parsed.data.id)
	return NextResponse.json({ ok: true })
}
