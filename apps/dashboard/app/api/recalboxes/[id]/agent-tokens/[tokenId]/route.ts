import { canControlRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { listAgentTokens, revokeAgentToken } from '@/lib/db/agent-queries'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string; tokenId: string }> }

export async function DELETE(_req: Request, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id, tokenId } = await params
	if (!canControlRecalbox(user, id)) return forbidden()

	// Make sure the token actually belongs to this Recalbox before revoking, so a
	// controller of one machine can't revoke another machine's token by id.
	const tokens = await listAgentTokens(db, id)
	if (!tokens.some((t) => t.id === tokenId))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	await revokeAgentToken(db, tokenId)
	return NextResponse.json({ ok: true })
}
