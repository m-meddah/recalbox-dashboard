import { getBearerToken } from '@/lib/agent/bearer'
import { deriveSystemFromGamelistPath, parseSystemGames } from '@/lib/agent/ingest-collection'
import { db } from '@/lib/db'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { upsertGames } from '@/lib/db/queries'
import { logger } from '@/lib/logger'
import { importInheritedStatsFromGames } from '@/lib/recalbox/sync-inherited-stats'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// One system per request (bounded payload size). The agent sets final=true on the
// last system so inherited stats are refreshed once, not after every system.
const Payload = z.object({
	gamelist_path: z.string().min(1),
	gamelist_xml: z.string(),
	userdata_ini: z.string().nullish(),
	final: z.boolean().optional(),
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

	const derived = deriveSystemFromGamelistPath(p.gamelist_path)
	if (!derived) {
		return NextResponse.json({ error: 'unrecognized_gamelist_path' }, { status: 400 })
	}

	try {
		const parsedGames = parseSystemGames(p.gamelist_xml, derived.romsBasePath, p.userdata_ini ?? null)
		const count = await upsertGames(parsedGames, derived.id, derived.diskSource, resolved.recalboxId)

		let inheritedRefreshed: number | undefined
		if (p.final) {
			const { imported } = await importInheritedStatsFromGames(db, resolved.recalboxId)
			inheritedRefreshed = imported
		}

		return NextResponse.json({ ok: true, system: derived.id, count, inheritedRefreshed }, { status: 201 })
	} catch (e) {
		logger.error('[agent/collection] failed', e)
		return NextResponse.json({ error: 'ingest_failed' }, { status: 500 })
	}
}
