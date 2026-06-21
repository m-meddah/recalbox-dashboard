import { getBearerToken } from '@/lib/agent/bearer'
import { db } from '@/lib/db'
import { completeCommand } from '@/lib/db/agent-commands'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Payload = z.object({
	id: z.string().min(1),
	ok: z.boolean(),
	result: z.string().max(4096).nullish(),
})

// Agent reports a command's outcome (claimed → done/failed). Scoped to the
// token's Recalbox, so an agent can never complete another box's command.
export async function POST(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })

	const resolved = await resolveAgentToken(db, token)
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	let json: unknown
	try {
		json = await req.json()
	} catch {
		return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
	}

	const parsed = Payload.safeParse(json)
	if (!parsed.success) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })

	const updated = await completeCommand(
		db,
		resolved.recalboxId,
		parsed.data.id,
		parsed.data.ok,
		parsed.data.result ?? null,
	)
	if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 })
	return NextResponse.json({ ok: true })
}
