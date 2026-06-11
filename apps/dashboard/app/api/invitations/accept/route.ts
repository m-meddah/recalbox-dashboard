import { InvalidInvitationError, acceptInvitation } from '@/lib/auth/invitations'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const acceptSchema = z.object({
	token: z.string().min(1),
	password: z.string().min(8).max(128),
})

export async function POST(req: NextRequest) {
	const body = await req.json().catch(() => null)
	const parsed = acceptSchema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 400 })
	}
	try {
		const { email } = await acceptInvitation(parsed.data)
		return NextResponse.json({ ok: true, email })
	} catch (err) {
		if (err instanceof InvalidInvitationError) {
			return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 400 })
		}
		throw err
	}
}
