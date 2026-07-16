import { loadRecalbox } from '@/lib/auth/recalbox-acl'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { fetchBiosInfo } from '@/lib/recalbox/bios'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
	if (!(await getUser())) return unauthorized()
	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	}

	const host = (await loadRecalbox(recalboxId))?.host
	if (!host) {
		return NextResponse.json({
			entries: [],
			summary: { total: 0, ok: 0, mismatch: 0, missing: 0 },
		})
	}

	const report = await fetchBiosInfo(host)
	return NextResponse.json(report)
}
