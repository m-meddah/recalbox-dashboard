import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { raAchievements, raGameMapping } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	const cfg = configStore.get().retroachievements
	if (!cfg.enabled) {
		return NextResponse.json([])
	}

	// Get all romPaths that have at least one unlocked achievement via the mapping table
	const rows = db
		.selectDistinct({ romPath: raGameMapping.romPath })
		.from(raGameMapping)
		.innerJoin(raAchievements, eq(raAchievements.gameId, raGameMapping.raGameId))
		.all()

	return NextResponse.json(rows.map((r) => r.romPath))
}
