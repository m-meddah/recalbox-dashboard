import { configStore } from '@/lib/config-store'
import { getAllGameProgress, getLiveGameProgress } from '@/lib/retroachievements/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}
	try {
		const dbProgress = await getAllGameProgress()
		if (dbProgress.length > 0) {
			return NextResponse.json(dbProgress)
		}
		const liveProgress = await getLiveGameProgress()
		return NextResponse.json(liveProgress)
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : 'Failed to fetch progress' },
			{ status: 502 },
		)
	}
}
