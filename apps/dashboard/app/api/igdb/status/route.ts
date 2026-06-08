import { getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { gameIgdbMapping, games, igdbCredentials } from '@/lib/db/schema'
import { eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	const [creds, totalGames, matched, notFound, needsReview] = await Promise.all([
		db.select().from(igdbCredentials).where(eq(igdbCredentials.id, 1)).get(),
		db.select({ c: sql<number>`COUNT(*)` }).from(games).get(),
		db
			.select({ c: sql<number>`COUNT(*)` })
			.from(gameIgdbMapping)
			.where(isNotNull(gameIgdbMapping.igdbId))
			.get(),
		db
			.select({ c: sql<number>`COUNT(*)` })
			.from(gameIgdbMapping)
			.where(isNull(gameIgdbMapping.igdbId))
			.get(),
		db
			.select({ c: sql<number>`COUNT(*)` })
			.from(gameIgdbMapping)
			.where(eq(gameIgdbMapping.needsReview, true))
			.get(),
	])

	return NextResponse.json({
		enabled: creds?.enabled ?? false,
		hasCredentials: !!(creds?.clientId && creds?.clientSecret),
		lastTestStatus: creds?.lastTestStatus ?? null,
		lastTestedAt: creds?.lastTestedAt ?? null,
		mapping: {
			totalGames: Number(totalGames?.c ?? 0),
			matched: Number(matched?.c ?? 0),
			notFound: Number(notFound?.c ?? 0),
			needsReview: Number(needsReview?.c ?? 0),
		},
	})
}
