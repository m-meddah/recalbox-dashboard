import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getPatronStatus } from '@/lib/recalbox/patron-status'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/patron/status
 * Returns PatronStatus with boolean fields only — the key value is never exposed.
 */
export async function GET() {
	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return NextResponse.json(
			{ isPatron: false, keyPresent: false, keyLooksValid: false },
			{ status: 200 },
		)
	}

	const ssh = getSshClient(recalboxId)
	const status = await getPatronStatus(ssh)
	return NextResponse.json(status, { headers: { 'Cache-Control': 'private, max-age=60' } })
}
