import { EmailAlreadyRegisteredError, createInvitation } from '@/lib/auth/invitations'
import { isAdmin } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { listPendingInvitations } from '@/lib/db/invitation-queries'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createSchema = z.object({
	email: z.string().email().max(254),
	role: z.enum(['member', 'admin']).optional(),
})

export async function GET() {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()
	return NextResponse.json({ invitations: listPendingInvitations() })
}

export async function POST(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()

	const body = await req.json().catch(() => null)
	const parsed = createSchema.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

	const email = parsed.data.email.trim().toLowerCase()
	const role = parsed.data.role ?? 'member'

	try {
		const { invitation, token } = createInvitation({ email, role, invitedByUserId: user.id })
		const base = (process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, '')
		const link = `${base}/accept-invite?token=${encodeURIComponent(token)}`
		return NextResponse.json({ link, email, expiresAt: invitation.expiresAt })
	} catch (err) {
		if (err instanceof EmailAlreadyRegisteredError) {
			return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
		}
		throw err
	}
}
