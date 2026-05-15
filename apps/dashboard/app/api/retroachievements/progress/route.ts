import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
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
		logger.error('Failed to fetch RA progress', err)
		return NextResponse.json({ error: 'Failed to fetch progress' }, { status: 502 })
	}
}
