import type { DB } from '@/lib/db'
import { artwork } from '@/lib/db/schema'
import { isServerlessMode } from '@/lib/serverless'
import { artworkContentType } from '@/lib/storage'
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm'

export type ArtworkRow = typeof artwork.$inferSelect

/**
 * SQLite caps the number of bound parameters per statement (999 by default), so
 * batched lookups and inserts are split. A collection page tops out at 200 rows,
 * well under this — the chunking only matters for bulk callers.
 */
const PARAM_CHUNK = 400

/**
 * Tentatives servies avant d'abandonner un chemin.
 *
 * La file ne se vide que sur un téléversement réussi : tout ce qui échoue y reste,
 * et l'agent renvoie le fichier ENTIER à chaque interrogation. Le 2026-09-07, trois
 * vidéos ainsi coincées ont coûté 30 Go en trois jours. Un plafond transforme une
 * boucle infinie en incident borné — cinq essais couvrent largement une panne
 * passagère (réseau, stockage objet), ce qu'aucun filtre d'extension ne couvre.
 */
export const MAX_WANTED_ATTEMPTS = 5

/**
 * Un chemin que le stockage objet refusera de toute façon n'a rien à faire dans la
 * file : `artworkContentType()` est EXACTEMENT le prédicat qu'applique la route de
 * téléversement, et c'est leur désaccord qui a créé la boucle — la file acceptait
 * tout, l'arrivée n'acceptait que des images.
 */
function isStorable(boxPath: string): boolean {
	return artworkContentType(boxPath) !== null
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
	return out
}

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
	if (!isStorable(boxPath)) return
	await db
		.insert(artwork)
		.values({ recalboxId, boxPath, url: null, wantedAt: new Date() })
		.onConflictDoNothing({ target: [artwork.recalboxId, artwork.boxPath] })
}

/**
 * Mark several box files as "wanted" in one statement. Same semantics as
 * {@link markWanted} — existing rows are left untouched, so an already-uploaded
 * URL is never clobbered and a re-render costs nothing after the first pass.
 */
export async function markWantedMany(
	db: DB,
	recalboxId: string,
	boxPaths: string[],
): Promise<void> {
	const storable = boxPaths.filter(isStorable)
	if (storable.length === 0) return
	const wantedAt = new Date()
	for (const paths of chunk(storable, PARAM_CHUNK)) {
		await db
			.insert(artwork)
			.values(paths.map((boxPath) => ({ recalboxId, boxPath, url: null, wantedAt })))
			.onConflictDoNothing({ target: [artwork.recalboxId, artwork.boxPath] })
	}
}

/** Stored URLs for a batch of box paths. Read-only; misses are simply absent. */
export async function lookupArtworkUrls(
	db: DB,
	recalboxId: string,
	boxPaths: string[],
): Promise<Map<string, string>> {
	const found = new Map<string, string>()
	if (boxPaths.length === 0) return found
	for (const paths of chunk([...new Set(boxPaths)], PARAM_CHUNK)) {
		const rows = await db
			.select({ boxPath: artwork.boxPath, url: artwork.url })
			.from(artwork)
			.where(and(eq(artwork.recalboxId, recalboxId), inArray(artwork.boxPath, paths)))
			.all()
		for (const row of rows) if (row.url) found.set(row.boxPath, row.url)
	}
	return found
}

/**
 * Resolve stored artwork URLs for a whole page of games in one round-trip, and
 * queue whatever is missing for the agent to upload.
 *
 * This is what keeps the render off `/api/media`: a hit is rendered as a direct
 * object-storage URL (served by the CDN, zero function invocations), and a miss
 * is requested here rather than costing one invocation per image just to call
 * `markWanted`. Requesting only makes sense where an agent actually uploads, so
 * outside serverless mode this is a pure read and the caller falls back to the
 * SSH media proxy.
 */
export async function resolveArtworkUrls(
	db: DB,
	recalboxId: string,
	boxPaths: (string | null | undefined)[],
): Promise<Map<string, string>> {
	if (!isServerlessMode()) return new Map()
	const paths = boxPaths.filter((p): p is string => !!p)
	const found = await lookupArtworkUrls(db, recalboxId, paths)
	const missing = [...new Set(paths)].filter((p) => !found.has(p))
	await markWantedMany(db, recalboxId, missing).catch(() => {})
	return found
}

/** Box paths the agent still needs to upload for its Recalbox (url not set yet). */
export async function listWanted(db: DB, recalboxId: string, limit = 50): Promise<ArtworkRow[]> {
	return db
		.select()
		.from(artwork)
		.where(
			and(
				eq(artwork.recalboxId, recalboxId),
				isNull(artwork.url),
				lt(artwork.attempts, MAX_WANTED_ATTEMPTS),
			),
		)
		.limit(limit)
		.all()
}

/**
 * Décompte une tentative pour chaque chemin remis à l'agent.
 *
 * Compté à la REMISE et non au retour : un échec qui n'atteint jamais la fonction
 * — corps trop gros rejeté par l'edge, agent qui renonce, réseau coupé — ne peut
 * rien rapporter, et c'est précisément celui-là qui tournait en boucle.
 */
export async function noteWantedAttempts(
	db: DB,
	recalboxId: string,
	boxPaths: string[],
): Promise<void> {
	if (boxPaths.length === 0) return
	for (const paths of chunk(boxPaths, PARAM_CHUNK)) {
		await db
			.update(artwork)
			.set({ attempts: sql`${artwork.attempts} + 1` })
			.where(and(eq(artwork.recalboxId, recalboxId), inArray(artwork.boxPath, paths)))
			.run()
	}
}

/** Sort un chemin de la file sans attendre l'épuisement du compteur : le cloud
 * vient de le refuser sur le fond, le réessayer ne changerait rien. */
export async function giveUpWanted(db: DB, recalboxId: string, boxPath: string): Promise<void> {
	await db
		.update(artwork)
		.set({ attempts: MAX_WANTED_ATTEMPTS })
		.where(and(eq(artwork.recalboxId, recalboxId), eq(artwork.boxPath, boxPath)))
		.run()
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
	// Le compteur retombe à zéro : il borne les échecs, il ne doit pas condamner un
	// chemin qui a fini par arriver — ni le suivant, si l'image est un jour remplacée.
	await db
		.insert(artwork)
		.values(row)
		.onConflictDoUpdate({
			target: [artwork.recalboxId, artwork.boxPath],
			set: { url, contentType, uploadedAt: row.uploadedAt, attempts: 0 },
		})
}
