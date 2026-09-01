import { getAgentVersion, getBearerToken } from '@/lib/agent/bearer'
import { db } from '@/lib/db'
import { claimPendingCommands } from '@/lib/db/agent-commands'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Agent poll: returns pending commands for the token's Recalbox and atomically
// claims them so each is delivered once. Outbound from the box → NAT-friendly.
export async function GET(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })

	const resolved = await resolveAgentToken(db, token, getAgentVersion(req))
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	const commands = await claimPendingCommands(db, resolved.recalboxId)
	return NextResponse.json({
		commands: commands.map((c) => ({ id: c.id, type: c.type, payload: c.payload ?? {} })),
	})
}
