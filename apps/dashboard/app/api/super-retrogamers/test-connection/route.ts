import { srClient } from '@/lib/super-retrogamers/client'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
	const t0 = Date.now()
	try {
		await srClient.listSystems()
		return NextResponse.json({ ok: true, latencyMs: Date.now() - t0 })
	} catch (err) {
		return NextResponse.json(
			{ ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
			{ status: 502 },
		)
	}
}
