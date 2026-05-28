import { inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { games } from '@/lib/db/schema'
import { getUserProfile } from '@/lib/profile/get-profile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const profile = await getUserProfile()

	const allGameIds = [...profile.comfortGames, ...profile.bouncerGames]

	const gamesInfo =
		allGameIds.length > 0
			? await db
					.select({
						id: games.id,
						name: games.name,
						system: games.system,
						imagePath: games.imagePath,
					})
					.from(games)
					.where(inArray(games.id, allGameIds))
					.all()
			: []

	const gameInfoMap = new Map(gamesInfo.map((g) => [g.id, g]))

	return NextResponse.json({
		systemsWeights: profile.systemsWeights,
		genresWeights: profile.genresWeights,
		decadesWeights: profile.decadesWeights,
		developersWeights: profile.developersWeights,
		comfortGames: profile.comfortGames.map((id) => gameInfoMap.get(id)).filter(Boolean),
		bouncerGames: profile.bouncerGames.map((id) => gameInfoMap.get(id)).filter(Boolean),
		totalSignalSessions: profile.totalSignalSessions,
		profileMaturity: profile.profileMaturity,
		computedAt: profile.computedAt,
	})
}
