import { getRecentSnapshots, insertSystemSnapshot } from '@/lib/db/queries'
import { logger } from '@/lib/logger'
import { getSystemStats } from '@/lib/recalbox/system-stats'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
	const { searchParams } = new URL(request.url)
	const historyMinutes = Number.parseInt(searchParams.get('history') ?? '0', 10)

	let stats
	try {
		stats = await getSystemStats()
	} catch (err) {
		logger.error('Failed to fetch system stats via SSH', err)
		return NextResponse.json({ error: 'Recalbox unreachable via SSH' }, { status: 503 })
	}

	try {
		await insertSystemSnapshot(stats)
	} catch (err) {
		logger.warn('Failed to persist system snapshot', err)
	}

	const body: Record<string, unknown> = { current: stats }

	if (historyMinutes > 0) {
		try {
			body['history'] = await getRecentSnapshots(historyMinutes)
		} catch (err) {
			logger.warn('Failed to fetch snapshot history', err)
			body['history'] = []
		}
	}

	return NextResponse.json(body)
}
