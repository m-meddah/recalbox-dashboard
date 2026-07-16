import { canViewRecalbox } from '@/lib/auth/ownership'
import { loadRecalbox } from '@/lib/auth/recalbox-acl'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { fetchSystemsCatalog } from '@/lib/recalbox/web-config'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!(await canViewRecalbox(user, recalboxId))) return forbidden()

	const host = (await loadRecalbox(recalboxId))?.host
	if (!host) return NextResponse.json({ systems: [] })

	const systems = await fetchSystemsCatalog(host)
	return NextResponse.json({ systems })
}
