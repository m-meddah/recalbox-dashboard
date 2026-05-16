import { getCachedStale, setCached } from '@/lib/super-retrogamers/cache'
import { type SrGame, srClient } from '@/lib/super-retrogamers/client'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params
	const cacheKey = `game:${slug}`

	const cached = getCachedStale<SrGame>(cacheKey)
	if (cached && !cached.stale) {
		return NextResponse.json(cached.value)
	}

	try {
		const game = await srClient.getGame(slug)
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
