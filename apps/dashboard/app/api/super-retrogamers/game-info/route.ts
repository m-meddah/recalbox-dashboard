import { getGameSrInfo } from '@/lib/db/queries'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
	const romPath = req.nextUrl.searchParams.get('romPath')
	if (!romPath) {
		return NextResponse.json({ error: 'romPath required' }, { status: 400 })
	}
	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	const info = getGameSrInfo(recalboxId, romPath)
	return NextResponse.json(info ?? { srHasPage: null, srUrl: null })
}
