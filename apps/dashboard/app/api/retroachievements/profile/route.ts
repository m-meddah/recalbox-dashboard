import { configStore } from '@/lib/config-store'
import { getProfile } from '@/lib/retroachievements/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled || !cfg.username || !cfg.apiKey) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}
	try {
		const profile = await getProfile()
		return NextResponse.json(profile)
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : 'Failed to fetch profile' },
			{ status: 502 },
		)
	}
}
