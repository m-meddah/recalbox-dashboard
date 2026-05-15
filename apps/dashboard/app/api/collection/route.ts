import { listGames } from '@/lib/db/queries'
import type { CollectionFilters } from '@/lib/db/queries'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/collection
 * Query params: system, favoritesOnly, neverPlayed, developer, search,
 *               sortBy, sortDir, page, pageSize
 */
export async function GET(req: NextRequest) {
	const p = req.nextUrl.searchParams

	const page = Math.max(1, Number(p.get('page') ?? 1))
	const pageSize = Math.min(200, Math.max(1, Number(p.get('pageSize') ?? 50)))

	const filters: CollectionFilters = {
		system: p.get('system') ?? undefined,
		favoritesOnly: p.get('favoritesOnly') === 'true',
		neverPlayed: p.get('neverPlayed') === 'true',
		developer: p.get('developer') ?? undefined,
		region: p.get('region') ?? undefined,
		search: p.get('search') ?? undefined,
		sortBy: (p.get('sortBy') as CollectionFilters['sortBy']) ?? 'name',
		sortDir: (p.get('sortDir') as CollectionFilters['sortDir']) ?? 'asc',
		limit: pageSize,
		offset: (page - 1) * pageSize,
	}

	const { games, total } = await listGames(filters)

	return NextResponse.json({ games, total, page, pageSize })
}
