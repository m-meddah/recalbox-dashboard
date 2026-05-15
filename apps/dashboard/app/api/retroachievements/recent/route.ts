import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { getYearAchievements } from '@/lib/retroachievements/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled || !cfg.username || !cfg.apiKey) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}

	try {
		const achievements = await getYearAchievements()
		return NextResponse.json(achievements)
	} catch (err) {
		logger.error('Failed to fetch RA achievements', err)
		return NextResponse.json({ error: 'Failed to fetch achievements' }, { status: 502 })
	}
}
