import { configStore } from '@/lib/config-store'
import { syncRetroAchievements } from '@/lib/retroachievements/sync'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled || !cfg.username || !cfg.apiKey) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}
	try {
		await syncRetroAchievements()
		return NextResponse.json({ ok: true })
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : 'Sync failed' },
			{ status: 502 },
		)
	}
}
