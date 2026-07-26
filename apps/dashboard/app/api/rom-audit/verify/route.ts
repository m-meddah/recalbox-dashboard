import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { availableTools, verifyEntry } from '@/lib/rom-audit/verify-service'
import { isServerlessMode } from '@/lib/serverless'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A verification pulls the file over and streams it through the tool; a DVD is
// minutes, not seconds.
export const maxDuration = 800

const Body = z.object({
	recalboxId: z.string().min(1),
	entryKey: z.string().min(1).max(2048),
})

/** Which tools the host has, so the UI can hide a button it cannot honour. */
export async function GET(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()

	const recalboxId = new URL(req.url).searchParams.get('recalboxId')
	if (!recalboxId) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	if (!(await canViewRecalbox(user, recalboxId)))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	// The cloud has neither the binaries nor the bandwidth to pull several GB.
	if (isServerlessMode()) return NextResponse.json({ serverless: true, tools: [] })
	return NextResponse.json({ serverless: false, tools: await availableTools() })
}

/**
 * Deep-verify one scanned entry.
 *
 * Owner-only: it consumes disk, bandwidth and CPU on the host, which is more
 * than a read.
 */
export async function POST(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()

	const body = await req.json().catch(() => null)
	const parsed = Body.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	const { recalboxId, entryKey } = parsed.data

	if (!(await canControlRecalbox(user, recalboxId))) return forbidden()
	if (!configStore.getRecalbox(recalboxId))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	if (isServerlessMode()) {
		return NextResponse.json({ error: 'unavailable_in_serverless' }, { status: 409 })
	}

	try {
		const outcome = await verifyEntry(recalboxId, entryKey)
		// "Entry not found" is a 404, not a failed verification: the row is gone or
		// never belonged to this box.
		if (outcome.status === 'failed' && outcome.reason === 'entry not found') {
			return NextResponse.json({ error: 'not_found' }, { status: 404 })
		}
		return NextResponse.json({ result: outcome })
	} catch (e) {
		logger.error('[rom-audit] deep verify failed', e)
		return NextResponse.json({ error: 'verify_failed' }, { status: 500 })
	}
}
