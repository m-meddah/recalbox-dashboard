import { canControlRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { type FrontendAction, restartFrontend } from '@/lib/recalbox/web-config'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTIONS: FrontendAction[] = ['restart', 'start', 'stop']

export async function POST(request: Request): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	const body = await request.json().catch(() => null)
	const action = body?.action
	if (!ACTIONS.includes(action)) {
		return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!canControlRecalbox(user, recalboxId)) return forbidden()

	const host = configStore.getRecalbox(recalboxId)?.host
	if (!host) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })

	try {
		await restartFrontend(host, action)
		return NextResponse.json({ ok: true })
	} catch (err) {
		logger.error(`Frontend action "${action}" failed`, err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}
