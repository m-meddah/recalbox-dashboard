import { canonicalTitle } from '@/lib/rom-audit/canonical'

/**
 * A `games` row is a ROM, not a game. The same title routinely occupies several
 * rows — regional dumps, redumps, and the same arcade board exposed by two
 * emulators (Metal Slug on `neogeo` *and* `fbneo`). EmulationStation only marks
 * one of them as a favorite, sessions only attach to the one actually launched,
 * and ratings only cover the one the user reviewed.
 *
 * So any per-row signal ("never played", "not a favorite", "skipped") leaks: the
 * twin row carries none of it and sails through the filters, which is how the
 * discovery mood kept proposing games the user had already hearted.
 *
 * The identity key collapses those rows onto the game they actually represent:
 *
 * - IGDB id when the row is matched (the strong signal — it groups regional
 *   variants and cross-emulator duplicates alike, and separates genuine
 *   homonyms);
 * - otherwise the normalised canonical title, which drops the region/revision
 *   tags `canonicalTitle` already knows about.
 *
 * The two namespaces are kept distinct on purpose: a matched row and an
 * unmatched row of the same game do NOT collapse together. Merging them would
 * take a title lookup per IGDB id, and getting it wrong silently hides games.
 */
export type IdentifiableGame = {
	igdbId: number | null
	name: string
}

export function gameIdentityKey(row: IdentifiableGame): string {
	if (row.igdbId != null) return `igdb:${row.igdbId}`
	return `title:${normalizeTitle(canonicalTitle(row.name))}`
}

/**
 * Combining marks left behind by the NFD decomposition below. Matched by the
 * Unicode Mark property rather than a literal U+0300–U+036F class, which Biome
 * rejects: a class holding combining characters can match a base character and
 * its mark as one unit.
 */
const COMBINING_MARKS = /\p{M}/gu

/**
 * Fold away the cosmetic differences gamelist scrapers introduce between two
 * dumps of one game: casing, spaced punctuation ("Zelda : A Link" vs
 * "Zelda: A Link"), and accents.
 */
function normalizeTitle(title: string): string {
	return title
		.normalize('NFD')
		.replace(COMBINING_MARKS, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
}
