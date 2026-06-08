import { getUser, unauthorized } from '@/lib/auth/require-user'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { executeSystemPower } from '@/lib/recalbox/system-power'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
	if (!(await getUser())) return unauthorized()
	const body = await request.json().catch(() => null)
	const action = body?.action

	if (action !== 'shutdown' && action !== 'reboot') {
		return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	}

	const ssh = getSshClient(recalboxId)

	try {
		await executeSystemPower(action, ssh)
		return NextResponse.json({ ok: true })
	} catch (err) {
		logger.error(`Power action "${action}" failed — Recalbox unreachable`, err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}
