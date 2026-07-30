import { canViewRecalbox } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { systemOverviews } from '@/lib/rom-audit/read-service'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Audit overview, one entry per system. Reads the aggregate table only — never
 * `rom_files` — so a box with 75k scanned entries costs the same single query as
 * an empty one.
 */
export async function GET(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()

	const recalboxId = new URL(req.url).searchParams.get('recalboxId')
	if (!recalboxId) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	if (!(await canViewRecalbox(user, recalboxId)))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	return NextResponse.json({ systems: await systemOverviews(recalboxId) })
}
