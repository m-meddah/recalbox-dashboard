import { db } from '@/lib/db'
import { gameIgdbMapping, igdbGameCache } from '@/lib/db/schema'
import { isIgdbEnabled } from '@/lib/igdb/auth'
import { igdbQuery } from '@/lib/igdb/client'
import { findCollectionGamesByIgdbIds } from '@/lib/igdb/find-in-collection'
import { eq } from 'drizzle-orm'

const CACHE_TTL_DAYS = 30

export interface SimilarityProvider {
	getSimilarToAny(gameIds: number[]): Promise<Set<number>>
	readonly name: 'igdb' | 'null'
}

class IgdbSimilarityProvider implements SimilarityProvider {
	readonly name = 'igdb' as const

	async getSimilarToAny(gameIds: number[]): Promise<Set<number>> {
		if (gameIds.length === 0) return new Set()

		const result = new Set<number>()
		for (const gameId of gameIds) {
			const similar = await this.getSimilarGamesInCollection(gameId)
			for (const id of similar) result.add(id)
		}
		for (const id of gameIds) result.delete(id)
		return result
	}

	private async getSimilarGamesInCollection(gameId: number): Promise<number[]> {
		const mapping = await db
			.select()
			.from(gameIgdbMapping)
			.where(eq(gameIgdbMapping.gameId, gameId))
			.get()
		if (!mapping?.igdbId) return []

		const similarIds = await this.getOrFetchSimilarIgdbIds(mapping.igdbId)
		if (similarIds.length === 0) return []

		const inCollection = await findCollectionGamesByIgdbIds(similarIds)
		return Array.from(inCollection.values())
	}

	private async getOrFetchSimilarIgdbIds(igdbId: number): Promise<number[]> {
		const cached = await db
			.select()
			.from(igdbGameCache)
			.where(eq(igdbGameCache.igdbId, igdbId))
			.get()

		if (cached && cached.expiresAt > new Date() && cached.similarGames) {
			return cached.similarGames
		}

		const result = await igdbQuery<
			Array<{
				id: number
				name: string
				similar_games?: number[]
				themes?: { name: string }[]
				game_modes?: { name: string }[]
				player_perspectives?: { name: string }[]
				rating?: number
				rating_count?: number
			}>
		>(
			'games',
			`fields name, similar_games, themes.name, game_modes.name,
             player_perspectives.name, rating, rating_count;
      where id = ${igdbId};`,
		)

		if (!result.ok || result.data.length === 0) return []

		const game = result.data[0]
		if (!game) return []
		const similarIds = game.similar_games ?? []

		const expiresAt = new Date()
		expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS)

		const themes = game.themes?.map((t) => t.name) ?? []
		const gameModes = game.game_modes?.map((m) => m.name) ?? []
		const playerPerspectives = game.player_perspectives?.map((p) => p.name) ?? []

		await db
			.insert(igdbGameCache)
			.values({
				igdbId,
				name: game.name,
				similarGames: similarIds,
				themes,
				gameModes,
				playerPerspectives,
				rating: game.rating ?? null,
				ratingCount: game.rating_count ?? null,
				rawPayload: game,
				expiresAt,
			})
			.onConflictDoUpdate({
				target: igdbGameCache.igdbId,
				set: {
					name: game.name,
					similarGames: similarIds,
					themes,
					gameModes,
					playerPerspectives,
					rating: game.rating ?? null,
					ratingCount: game.rating_count ?? null,
					rawPayload: game,
					fetchedAt: new Date(),
					expiresAt,
				},
			})

		return similarIds
	}
}

class NullSimilarityProvider implements SimilarityProvider {
	readonly name = 'null' as const
	async getSimilarToAny(): Promise<Set<number>> {
		return new Set()
	}
}

export async function getSimilarityProvider(): Promise<SimilarityProvider> {
	if (await isIgdbEnabled()) return new IgdbSimilarityProvider()
	return new NullSimilarityProvider()
}
