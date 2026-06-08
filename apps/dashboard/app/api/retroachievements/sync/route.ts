import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { syncRetroAchievements } from '@/lib/retroachievements/sync'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
	if (!(await getUser())) return unauthorized()
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled || !cfg.username || !cfg.apiKey) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}
	try {
		await syncRetroAchievements()
		return NextResponse.json({ ok: true })
	} catch (err) {
		logger.error('RA sync failed', err)
		return NextResponse.json({ error: 'Sync failed' }, { status: 502 })
	}
}
