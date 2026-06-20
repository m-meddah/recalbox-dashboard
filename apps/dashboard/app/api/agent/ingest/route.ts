import { ingestAgentSession } from '@/lib/agent/ingest'
import { db } from '@/lib/db'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { logger } from '@/lib/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Matches the payload the on-device agent posts (snake_case). recalbox_id/source
// in the body are intentionally ignored — the bearer token is the source of
// truth for which Recalbox this belongs to.
const Payload = z.object({
	started_at: z.coerce.date(),
	ended_at: z.coerce.date(),
	duration_seconds: z.number().int().nonnegative(),
	system: z.string().min(1),
	rom_path: z.string().min(1),
	game_name: z.string().nullish(),
	auto_closed: z.boolean().optional(),
	closed_reason: z.string().nullish(),
})

function bearerToken(req: NextRequest): string | null {
	const header = req.headers.get('authorization') ?? ''
	const match = /^Bearer\s+(.+)$/i.exec(header)
	return match?.[1]?.trim() || null
}

export async function POST(req: NextRequest) {
	const token = bearerToken(req)
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
	if (!parsed.success) {
		return NextResponse.json(
			{ error: 'invalid_payload', details: parsed.error.format() },
			{ status: 400 },
		)
	}
	const p = parsed.data

	try {
		const result = await ingestAgentSession(db, resolved.recalboxId, {
			startedAt: p.started_at,
			endedAt: p.ended_at,
			durationSeconds: p.duration_seconds,
			system: p.system,
			romPath: p.rom_path,
			gameName: p.game_name ?? null,
			autoClosed: p.auto_closed ?? false,
			closedReason: p.closed_reason ?? null,
		})
		return NextResponse.json(
			{ ok: true, created: result.created, sessionId: result.sessionId },
			{ status: result.created ? 201 : 200 },
		)
	} catch (e) {
		logger.error('[agent/ingest] failed', e)
		return NextResponse.json({ error: 'ingest_failed' }, { status: 500 })
	}
}
