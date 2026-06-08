import { getUser, unauthorized } from '@/lib/auth/require-user'
import { type BatchProgress, batchMatchAll, batchMatchPlayedGames } from '@/lib/igdb/batch-match'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// In-memory state (acceptable for single-process self-hosted app)
let currentProgress: BatchProgress | null = null
let isRunning = false

export async function POST(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
	if (isRunning) {
		return NextResponse.json({ ok: false, error: 'already_running' }, { status: 409 })
	}

	const scope = req.nextUrl.searchParams.get('scope') ?? 'played'

	isRunning = true
	currentProgress = { total: 0, done: 0, matched: 0, notFound: 0, needsReview: 0, errors: 0 }

	const runner = scope === 'all' ? batchMatchAll : batchMatchPlayedGames

	runner((p) => {
		currentProgress = { ...p }
	})
		.then(() => {
			isRunning = false
		})
		.catch((e) => {
			console.error('[igdb] Batch failed:', e)
			isRunning = false
		})

	return NextResponse.json({ ok: true, started: true, scope })
}

export function getMatchState() {
	return { isRunning, progress: currentProgress }
}
