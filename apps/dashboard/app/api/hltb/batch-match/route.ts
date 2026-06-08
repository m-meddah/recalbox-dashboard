import { getUser, unauthorized } from '@/lib/auth/require-user'
import { type HltbBatchProgress, batchMatchHltb } from '@/lib/hltb/batch-match'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

let currentProgress: HltbBatchProgress | null = null
let isRunning = false

export async function POST() {
	if (!(await getUser())) return unauthorized()
	if (isRunning) {
		return NextResponse.json({ ok: false, error: 'already_running' }, { status: 409 })
	}

	isRunning = true
	currentProgress = { total: 0, done: 0, matched: 0, notFound: 0, needsReview: 0, errors: 0 }

	batchMatchHltb((p) => {
		currentProgress = { ...p }
	})
		.then(() => {
			isRunning = false
		})
		.catch((e) => {
			console.error('[hltb] Batch failed:', e)
			isRunning = false
		})

	return NextResponse.json({ ok: true, started: true })
}

export function getMatchState() {
	return { isRunning, progress: currentProgress }
}
