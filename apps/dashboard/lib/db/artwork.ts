import type { DB } from '@/lib/db'
import { artwork } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'

export type ArtworkRow = typeof artwork.$inferSelect

/** Look up a stored artwork row for a (recalbox, box path). */
export async function getArtwork(
	db: DB,
	recalboxId: string,
	boxPath: string,
): Promise<ArtworkRow | undefined> {
	return db
		.select()
		.from(artwork)
		.where(and(eq(artwork.recalboxId, recalboxId), eq(artwork.boxPath, boxPath)))
		.get()
}

/**
 * Mark a box file as "wanted" so the agent uploads it on its next poll. No-op if
 * a row already exists (wanted or already uploaded) — never clobbers a URL.
 */
export async function markWanted(db: DB, recalboxId: string, boxPath: string): Promise<void> {
	await db
		.insert(artwork)
		.values({ recalboxId, boxPath, url: null, wantedAt: new Date() })
		.onConflictDoNothing({ target: [artwork.recalboxId, artwork.boxPath] })
}

/** Box paths the agent still needs to upload for its Recalbox (url not set yet). */
export async function listWanted(db: DB, recalboxId: string, limit = 50): Promise<ArtworkRow[]> {
	return db
		.select()
		.from(artwork)
		.where(and(eq(artwork.recalboxId, recalboxId), isNull(artwork.url)))
		.limit(limit)
		.all()
}

/** Record a successful upload, clearing the wanted state. */
export async function saveArtwork(
	db: DB,
	recalboxId: string,
	boxPath: string,
	url: string,
	contentType: string | null,
): Promise<void> {
	const row = { recalboxId, boxPath, url, contentType, uploadedAt: new Date() }
	await db
		.insert(artwork)
		.values(row)
		.onConflictDoUpdate({
			target: [artwork.recalboxId, artwork.boxPath],
			set: { url, contentType, uploadedAt: row.uploadedAt },
		})
}
