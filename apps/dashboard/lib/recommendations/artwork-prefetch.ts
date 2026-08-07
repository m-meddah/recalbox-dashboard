import { db } from '@/lib/db'
import { markWantedMany } from '@/lib/db/artwork'
import { logger } from '@/lib/logger'

type MediaPaths = { imagePath: string | null; videoPath: string | null }

/**
 * Marks each game's image/video box path "wanted" so the on-box agent uploads it
 * to blob storage on its next poll — started as soon as a game is recommended or
 * launched, instead of waiting for a browser to render the card and 404 first.
 */
export async function prefetchArtwork(recalboxId: string, games: MediaPaths[]): Promise<void> {
	const paths = new Set<string>()
	for (const g of games) {
		if (g.imagePath) paths.add(g.imagePath)
		if (g.videoPath) paths.add(g.videoPath)
	}

	// One statement for the whole batch rather than a markWanted round-trip per path.
	await markWantedMany(db, recalboxId, Array.from(paths)).catch((err) => {
		logger.error('[artwork-prefetch] markWanted failed', err)
	})
}
