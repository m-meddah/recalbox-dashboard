import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { getProfile } from '@/lib/retroachievements/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled || !cfg.username || !cfg.apiKey) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}
	try {
		const profile = await getProfile()
		return NextResponse.json(profile)
	} catch (err) {
		logger.error('Failed to fetch RA profile', err)
		return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 502 })
	}
}
