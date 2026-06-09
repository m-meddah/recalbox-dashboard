import { canControlRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getEsState } from '@/lib/recalbox/es-state'
import { isLaunchable, launchGame } from '@/lib/recalbox/launch-game'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/collection/launch  { romPath, system }
 * Asks the Recalbox's EmulationStation to launch a game (UDP command).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()
	let body: { romPath?: unknown; system?: unknown }
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
	}

	const { romPath, system } = body
	if (typeof romPath !== 'string' || typeof system !== 'string' || !isLaunchable(system, romPath)) {
		return NextResponse.json({ error: 'Invalid romPath or system' }, { status: 400 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	}
	if (!canControlRecalbox(user, recalboxId)) return forbidden()

	// Refuse to launch over a running game — ES would silently queue it and start it
	// only after the current game quits (surprising the user). The browser already
	// disables the button on live events; this guards the case where the box was busy
	// before any event reached the client.
	const state = await getEsState(recalboxId)
	if (state?.gameRunning) {
		return NextResponse.json({ error: 'busy', gameName: state.gameName }, { status: 409 })
	}

	try {
		await launchGame(recalboxId, system, romPath)
		return NextResponse.json({ ok: true })
	} catch (err) {
		logger.error('Game launch failed', err)
		return NextResponse.json({ error: 'Launch failed' }, { status: 502 })
	}
}
