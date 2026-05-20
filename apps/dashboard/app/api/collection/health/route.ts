import { getCollectionHealth } from '@/lib/collection-health'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/collection/health
 * Optional query param: ?system=psx  (filter results to a single system)
 */
export async function GET(req: NextRequest) {
	const recalboxId = await getActiveRecalboxId()
	const health = await getCollectionHealth(recalboxId ?? undefined)

	const system = req.nextUrl.searchParams.get('system')
	if (system) {
		return NextResponse.json({
			...health,
			bySystem: health.bySystem.filter((s) => s.system === system),
			unscrapedGames: health.unscrapedGames.filter((g) => g.system === system),
		})
	}

	return NextResponse.json(health)
}
