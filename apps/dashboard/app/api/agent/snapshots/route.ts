import { getBearerToken } from '@/lib/agent/bearer'
import { ingestSnapshot } from '@/lib/agent/ingest-snapshot'
import { db } from '@/lib/db'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { logger } from '@/lib/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Payload = z.object({
	captured_at: z.coerce.date(),
	cpu_percent: z.number().nullish(),
	mem_used_mb: z.number().nullish(),
	mem_total_mb: z.number().nullish(),
	temp_celsius: z.number().nullish(),
	uptime_seconds: z.number().int().nullish(),
})

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
	if (!parsed.success) {
		return NextResponse.json(
			{ error: 'invalid_payload', details: parsed.error.format() },
			{ status: 400 },
		)
	}
	const p = parsed.data

	try {
		const { id } = await ingestSnapshot(db, resolved.recalboxId, {
			capturedAt: p.captured_at,
			cpuPercent: p.cpu_percent ?? null,
			memUsedMb: p.mem_used_mb ?? null,
			memTotalMb: p.mem_total_mb ?? null,
			tempCelsius: p.temp_celsius ?? null,
			uptimeSeconds: p.uptime_seconds ?? null,
		})
		return NextResponse.json({ ok: true, id }, { status: 201 })
	} catch (e) {
		logger.error('[agent/snapshots] failed', e)
		return NextResponse.json({ error: 'ingest_failed' }, { status: 500 })
	}
}
