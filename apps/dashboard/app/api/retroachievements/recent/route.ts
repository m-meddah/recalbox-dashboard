import { configStore } from '@/lib/config-store'
import { getRecentAchievements } from '@/lib/retroachievements/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled || !cfg.username || !cfg.apiKey) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}

	const { searchParams } = new URL(request.url)
	const count = Math.min(Number(searchParams.get('count') ?? '20'), 50)

	try {
		const achievements = await getRecentAchievements(count)
		return NextResponse.json(achievements)
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : 'Failed to fetch achievements' },
			{ status: 502 },
		)
	}
}
