import { getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { resolveArtworkUrls } from '@/lib/db/artwork'
import { games } from '@/lib/db/schema'
import { getUserProfile } from '@/lib/profile/get-profile'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
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
						recalboxId: games.recalboxId,
					})
					.from(games)
					.where(inArray(games.id, allGameIds))
					.all()
			: []

	const recalboxId = await getActiveRecalboxId()
	const urls = recalboxId
		? await resolveArtworkUrls(
				db,
				recalboxId,
				gamesInfo.filter((g) => g.recalboxId === recalboxId).map((g) => g.imagePath),
			)
		: new Map<string, string>()

	const gameInfoMap = new Map(
		gamesInfo.map(({ recalboxId: _unused, ...g }) => [
			g.id,
			{ ...g, imageUrl: (g.imagePath && urls.get(g.imagePath)) || null },
		]),
	)

	return NextResponse.json({
		systemsWeights: profile.systemsWeights,
		genresWeights: profile.genresWeights,
		decadesWeights: profile.decadesWeights,
		developersWeights: profile.developersWeights,
		comfortGames: profile.comfortGames.flatMap((id) => {
			const g = gameInfoMap.get(id)
			return g ? [g] : []
		}),
		bouncerGames: profile.bouncerGames.flatMap((id) => {
			const g = gameInfoMap.get(id)
			return g ? [g] : []
		}),
		totalSignalSessions: profile.totalSignalSessions,
		profileMaturity: profile.profileMaturity,
		computedAt: profile.computedAt,
	})
}
