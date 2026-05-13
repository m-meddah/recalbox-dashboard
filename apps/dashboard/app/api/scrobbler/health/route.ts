import { NextResponse } from 'next/server'
import { getOpenSessions } from '@/lib/db/queries'
import { db } from '@/lib/db/index'
import { sessions } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	try {
		const [openSessions, lastSessionRows] = await Promise.all([
			getOpenSessions(),
			db.select({ startedAt: sessions.startedAt }).from(sessions).orderBy(desc(sessions.startedAt)).limit(1),
		])

		const lastEventAt = lastSessionRows[0]?.startedAt ?? null

		return NextResponse.json({
			isHealthy: true,
			openSessions: openSessions.length,
			lastEventAt,
		})
	} catch (err) {
		return NextResponse.json({ isHealthy: false, error: String(err) }, { status: 500 })
	}
}
