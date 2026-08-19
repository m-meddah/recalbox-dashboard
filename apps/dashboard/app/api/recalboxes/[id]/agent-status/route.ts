import { canViewRecalbox } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { listAgentTokens } from '@/lib/db/agent-queries'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/**
 * « Cette box a-t-elle déjà appelé ? » — c'est le feu vert de l'écran d'attente de
 * l'assistant. Le signal est le `lastUsedAt` du token, touché à chaque requête de
 * l'agent : le premier appel suffit, on ne cherche pas la fraîcheur ici.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!(await canViewRecalbox(user, id)))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const tokens = await listAgentTokens(db, id)
	const stamps = tokens.flatMap((t) => (t.revokedAt || !t.lastUsedAt ? [] : [t.lastUsedAt]))
	const last = stamps.reduce<Date | null>(
		(acc, d) => (acc == null || d > acc ? d : acc),
		null,
	)

	return NextResponse.json({ seen: last != null, lastSeenAt: last?.toISOString() ?? null })
}
