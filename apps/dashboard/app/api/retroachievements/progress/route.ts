import { configStore } from '@/lib/config-store'
import { getAllGameProgress } from '@/lib/retroachievements/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}
	try {
		const progress = await getAllGameProgress()
		return NextResponse.json(progress)
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : 'Failed to fetch progress' },
			{ status: 502 },
		)
	}
}
