import { isAdmin } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { deleteInvitationById } from '@/lib/db/invitation-queries'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(_req: Request, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()
	const { id } = await params
	deleteInvitationById(id)
	return NextResponse.json({ ok: true })
}
