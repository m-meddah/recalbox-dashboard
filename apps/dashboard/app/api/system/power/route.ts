import { logger } from '@/lib/logger'
import { executeSystemPower } from '@/lib/recalbox/system-power'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
	const body = await request.json().catch(() => null)
	const action = body?.action

	if (action !== 'shutdown' && action !== 'reboot') {
		return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
	}

	try {
		await executeSystemPower(action)
		return NextResponse.json({ ok: true })
	} catch (err) {
		logger.error(`Power action "${action}" failed — Recalbox unreachable`, err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}
