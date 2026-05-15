import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { findRaGameForRom, setManualMapping } from '@/lib/retroachievements/matching'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const manualMatchSchema = z.object({
	romPath: z.string().min(1),
	raGameId: z.number().int().positive(),
})

export async function GET(request: Request) {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}

	const { searchParams } = new URL(request.url)
	const romPath = searchParams.get('romPath')
	const system = searchParams.get('system')

	if (!romPath || !system) {
		return NextResponse.json({ error: 'Missing romPath or system' }, { status: 400 })
	}

	try {
		const raGameId = await findRaGameForRom(romPath, system)
		return NextResponse.json({ romPath, raGameId })
	} catch (err) {
		logger.error('RA matching failed', err)
		return NextResponse.json({ error: 'Matching failed' }, { status: 502 })
	}
}

export async function POST(req: NextRequest) {
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}

	const parsed = manualMatchSchema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
	}

	await setManualMapping(parsed.data.romPath, parsed.data.raGameId)
	return NextResponse.json({ ok: true })
}
