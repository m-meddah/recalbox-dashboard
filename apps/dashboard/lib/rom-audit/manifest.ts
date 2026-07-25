import { z } from 'zod'

/** How the on-box scanner identified the file — mirrors the five strategies in the spec. */
export const ROM_KINDS = ['zip-entry', 'chd', 'rvz', 'sevenzip-entry', 'raw'] as const

const lowerHex = z
	.string()
	.regex(/^[0-9a-fA-F]+$/)
	.transform((s) => s.toLowerCase())

export const manifestEntrySchema = z.object({
	path: z.string().min(1),
	size: z.number().int().nonnegative(),
	mtime: z.number().int().nonnegative(),
	system: z.string().min(1),
	mount: z.string().min(1),
	kind: z.enum(ROM_KINDS),
	crc32: lowerHex.optional(),
	md5: lowerHex.optional(),
	sha1: lowerHex.optional(),
	/** CHD only: SHA1 of the decompressed data stream, deterministic across chdman versions. */
	rawSha1: lowerHex.optional(),
	/** RVZ/ISO only: the 4-character game code read from the disc header. */
	serial: z.string().optional(),
	discNumber: z.number().int().nonnegative().optional(),
	discVersion: z.number().int().nonnegative().optional(),
	/** Name of the entry inside the archive, when the file is a container. */
	innerName: z.string().optional(),
})

export type ManifestEntry = z.infer<typeof manifestEntrySchema>

export function parseManifest(input: unknown): ManifestEntry[] {
	return z.array(manifestEntrySchema).parse(input)
}
