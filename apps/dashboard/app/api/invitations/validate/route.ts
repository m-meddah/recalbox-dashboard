import { validateInvitation } from '@/lib/auth/invitations'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
	const token = new URL(req.url).searchParams.get('token') ?? ''
	const invite = validateInvitation(token)
	if (!invite) return NextResponse.json({ valid: false })
	return NextResponse.json({ valid: true, email: invite.email })
}
