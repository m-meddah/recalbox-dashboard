import { z } from 'zod'

/** How the on-box scanner identified the file — mirrors the five strategies in the spec. */
export const ROM_KINDS = ['zip-entry', 'chd', 'rvz', 'sevenzip-entry', 'raw'] as const

const lowerHex = (length: number) =>
	z
		.string()
		.regex(new RegExp(`^[0-9a-fA-F]{${length}}$`))
		.transform((s) => s.toLowerCase())

/** True for any C0 control character (null byte and newlines included). */
function hasControlCharacter(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		if (s.charCodeAt(i) <= 0x1f) return true
	}
	return false
}

// path/mount cross a trust boundary (SSH scan or agent push over HTTP) and a
// downstream consumer may build an SSH/shell command from them — reject
// traversal segments, null bytes, and control characters (newlines included)
// outright rather than trying to sanitize them.
const safeFsPath = z
	.string()
	.min(1)
	.refine((s) => !hasControlCharacter(s), 'must not contain control characters')
	.refine((s) => !s.split('/').includes('..'), 'must not contain a ".." segment')

export const manifestEntrySchema = z
	.object({
		path: safeFsPath,
		size: z.number().int().nonnegative(),
		mtime: z.number().int().nonnegative(),
		system: z.string().min(1),
		mount: safeFsPath,
		kind: z.enum(ROM_KINDS),
		crc32: lowerHex(8).optional(),
		md5: lowerHex(32).optional(),
		sha1: lowerHex(40).optional(),
		/** CHD only: SHA1 of the decompressed data stream, deterministic across chdman versions. */
		rawSha1: lowerHex(40).optional(),
		/** RVZ only: the 4-character game code read from the disc header. */
		serial: z.string().length(4).optional(),
		discNumber: z.number().int().nonnegative().optional(),
		discVersion: z.number().int().nonnegative().optional(),
		/** Name of the entry inside the archive, when the file is a container. */
		innerName: z.string().optional(),
	})
	.superRefine((entry, ctx) => {
		if (entry.rawSha1 !== undefined && entry.kind !== 'chd') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['rawSha1'],
				message: 'rawSha1 only applies to kind "chd"',
			})
		}
		if (entry.kind !== 'rvz') {
			if (entry.serial !== undefined) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['serial'],
					message: 'serial only applies to kind "rvz"',
				})
			}
			if (entry.discNumber !== undefined) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['discNumber'],
					message: 'discNumber only applies to kind "rvz"',
				})
			}
			if (entry.discVersion !== undefined) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['discVersion'],
					message: 'discVersion only applies to kind "rvz"',
				})
			}
		}
	})

export type ManifestEntry = z.infer<typeof manifestEntrySchema>

export function parseManifest(input: unknown): ManifestEntry[] {
	return z.array(manifestEntrySchema).parse(input)
}
