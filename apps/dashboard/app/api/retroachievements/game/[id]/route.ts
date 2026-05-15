import { configStore } from '@/lib/config-store'
import { getGameProgress } from '@/lib/retroachievements/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled) {
		return NextResponse.json({ error: 'RetroAchievements not configured' }, { status: 503 })
	}

	const { id } = await params
	const gameId = Number(id)
	if (!Number.isInteger(gameId) || gameId <= 0) {
		return NextResponse.json({ error: 'Invalid game id' }, { status: 400 })
	}

	try {
		const progress = await getGameProgress(gameId)
		if (!progress) return NextResponse.json({ error: 'Not found' }, { status: 404 })
		return NextResponse.json(progress)
	} catch (err) {
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : 'Failed to fetch game progress' },
			{ status: 502 },
		)
	}
}
