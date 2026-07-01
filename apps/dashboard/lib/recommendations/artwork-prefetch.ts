import { db } from '@/lib/db'
import { markWanted } from '@/lib/db/artwork'
import { logger } from '@/lib/logger'

type MediaPaths = { imageUrl: string | null; videoUrl: string | null }

/**
 * Marks each game's image/video box path "wanted" so the on-box agent uploads it
 * to blob storage on its next poll — started as soon as a game is recommended or
 * launched, instead of waiting for a browser to render the card and 404 first.
 */
export async function prefetchArtwork(recalboxId: string, games: MediaPaths[]): Promise<void> {
	const paths = new Set<string>()
	for (const g of games) {
		if (g.imageUrl) paths.add(g.imageUrl)
		if (g.videoUrl) paths.add(g.videoUrl)
	}

	await Promise.all(
		Array.from(paths).map((path) =>
			markWanted(db, recalboxId, path).catch((err) => {
				logger.error('[artwork-prefetch] markWanted failed', err)
			}),
		),
	)
}
