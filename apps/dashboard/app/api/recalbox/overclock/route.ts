import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { OVERCLOCK_KEY, readOverclockInfo } from '@/lib/recalbox/overclock'
import { RECALBOX_CONF_PATH, setConfValues } from '@/lib/recalbox/recalbox-conf-editor'
import { shellQuote } from '@/lib/recalbox/shell'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/recalbox/overclock
 * Returns the overclock state: available profiles, current profile, model and
 * live thermal/throttle status.
 */
export async function GET(): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!(await canViewRecalbox(user, recalboxId))) return forbidden()

	const info = await readOverclockInfo(recalboxId)
	return NextResponse.json({ info })
}

/**
 * POST /api/recalbox/overclock  { profile: string | null }
 * Sets `system.overclocking` to the chosen profile (null clears it → stock clocks).
 * The profile is validated against the board's available list to prevent writing an
 * arbitrary path. Takes effect on the next reboot.
 */
export async function POST(req: Request): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	let body: { profile?: unknown }
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
	}

	const profile = body.profile
	if (profile !== null && typeof profile !== 'string') {
		return NextResponse.json({ error: 'Invalid profile' }, { status: 400 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!(await canControlRecalbox(user, recalboxId))) return forbidden()

	try {
		const info = await readOverclockInfo(recalboxId)
		if (!info.supported || !info.profilesDir) {
			return NextResponse.json({ error: 'Overclocking not supported' }, { status: 400 })
		}
		// Anti path-injection: only known profile basenames (or null) are accepted.
		if (profile !== null && !info.available.includes(profile)) {
			return NextResponse.json({ error: 'Unknown profile' }, { status: 400 })
		}

		const ssh = getSshClient(recalboxId)
		const conf = await ssh.exec(`cat ${shellQuote(RECALBOX_CONF_PATH)} 2>/dev/null || true`, 10_000)
		if (!conf.trim())
			return NextResponse.json({ error: 'recalbox.conf not found' }, { status: 404 })

		const value = profile === null ? null : `${info.profilesDir}/${profile}.txt`
		const next = setConfValues(conf, { [OVERCLOCK_KEY]: value })
		await ssh.writeFile(RECALBOX_CONF_PATH, next, {
			backupPath: `${RECALBOX_CONF_PATH}.bak-dashboard`,
			timeoutMs: 15_000,
		})
		logger.info(`overclock: ${profile ?? '(stock)'}`)
		return NextResponse.json({ ok: true, rebootRequired: true })
	} catch (err) {
		logger.error('overclock POST failed', err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}
