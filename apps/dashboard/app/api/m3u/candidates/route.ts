import { db } from '@/lib/db/index'
import { games } from '@/lib/db/schema'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { detectMultiDiscGames, MULTIDISC_SYSTEMS } from '@/lib/recalbox/multidisc-detector'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
	const system = req.nextUrl.searchParams.get('system') ?? undefined

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	}

	const ssh = getSshClient(recalboxId)
	const candidates = await detectMultiDiscGames(ssh, system)

	const presentSystems = db
		.select({ system: games.system })
		.from(games)
		.where(inArray(games.system, [...MULTIDISC_SYSTEMS]))
		.all()
		.map((r) => r.system)
		.filter((s, i, arr) => arr.indexOf(s) === i)
		.sort()

	return NextResponse.json({ candidates, systems: presentSystems })
}
