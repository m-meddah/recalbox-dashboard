import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { getCachedStale, setCached } from '@/lib/super-retrogamers/cache'
import { type SrGame, srClient } from '@/lib/super-retrogamers/client'
import { resolveRegion } from '@/lib/super-retrogamers/region'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
	if (!(await getUser())) return unauthorized()
	const { slug } = await params
	// Optional ?region= carries the ROM's region (ScreenScraper code); the client
	// resolves it (ROM region → preferredRegion → FR), and the cache is keyed by it.
	const romRegion = req.nextUrl.searchParams.get('region')
	const region = resolveRegion(romRegion, configStore.get().superRetrogamers.preferredRegion)
	const cacheKey = `game:${slug}:${region || 'FR'}`

	const cached = getCachedStale<SrGame>(cacheKey)
	if (cached && !cached.stale) {
		return NextResponse.json(cached.value)
	}

	try {
		const game = await srClient.getGame(slug, romRegion ?? undefined)
		if (game) {
			setCached(cacheKey, game)
			return NextResponse.json(game)
		}
		if (cached?.stale) {
			return NextResponse.json({ ...cached.value, stale: true })
		}
		return NextResponse.json(null)
	} catch {
		if (cached) {
			return NextResponse.json({ ...cached.value, stale: true })
		}
		return NextResponse.json(null)
	}
}
