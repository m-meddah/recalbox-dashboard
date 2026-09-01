import { getAgentVersion, getBearerToken } from '@/lib/agent/bearer'
import { db } from '@/lib/db'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { upsertNowPlaying } from '@/lib/db/now-playing'
import { logger } from '@/lib/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Payload = z.object({
	playing: z.boolean(),
	system: z.string().nullish(),
	system_full_name: z.string().nullish(),
	rom_path: z.string().nullish(),
	game_name: z.string().nullish(),
	image_path: z.string().nullish(),
	emulator: z.string().nullish(),
	from_screensaver: z.boolean().nullish(),
	started_at: z.coerce.date().nullish(),
})

// Agent pushes the box's live "now playing" state (game start/stop). One row per
// Recalbox; relayed to browsers by the SSE endpoint's DB poll.
export async function POST(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })

	const resolved = await resolveAgentToken(db, token, getAgentVersion(req))
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	let json: unknown
	try {
		json = await req.json()
	} catch {
		return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
	}

	const parsed = Payload.safeParse(json)
	if (!parsed.success) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
	const p = parsed.data

	try {
		await upsertNowPlaying(db, resolved.recalboxId, {
			playing: p.playing,
			system: p.system ?? null,
			systemFullName: p.system_full_name ?? null,
			romPath: p.rom_path ?? null,
			gameName: p.game_name ?? null,
			imagePath: p.image_path ?? null,
			emulator: p.emulator ?? null,
			fromScreensaver: p.from_screensaver ?? false,
			startedAt: p.started_at ?? null,
		})
		return NextResponse.json({ ok: true }, { status: 201 })
	} catch (e) {
		logger.error('[agent/now-playing] failed', e)
		return NextResponse.json({ error: 'ingest_failed' }, { status: 500 })
	}
}
