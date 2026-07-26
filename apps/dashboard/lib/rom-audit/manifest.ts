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

// A system id is a `/roms` directory name, and it ends up as a path segment and
// a database key — so it gets the same safety guard as a path, plus a ban on
// separators so it can never widen into one.
//
// Deliberately NOT restricted to the slug shape of the 78 catalogued systems:
// the spec requires listing every `/roms` directory, including ones with no
// catalogue and no gamelist. Real disks carry `@eaDir`, `.stversions` and
// hand-made folders, and `parseManifest` rejects the WHOLE array on one bad
// entry — a whitelist here would abort an entire scan over a stray directory.
// An unmapped system degrades to inventory-only, which is a supported state.
const systemId = safeFsPath
	.max(64)
	.refine((s) => !s.includes('/') && !s.includes('\\'), 'must not contain a path separator')

export const manifestEntrySchema = z
	.object({
		path: safeFsPath,
		size: z.number().int().nonnegative(),
		mtime: z.number().int().nonnegative(),
		system: systemId,
		mount: safeFsPath,
		kind: z.enum(ROM_KINDS),
		crc32: lowerHex(8).optional(),
		md5: lowerHex(32).optional(),
		sha1: lowerHex(40).optional(),
		/** CHD only: SHA1 of the decompressed data stream, deterministic across chdman versions. */
		rawSha1: lowerHex(40).optional(),
		/**
		 * The 4-character game code read from the disc header. The disc-header
		 * strategy covers RVZ *and* bare GameCube/Wii ISO images, and both declare
		 * `kind: 'rvz'` — the kind names the strategy, not the container. A bare
		 * ISO sent under any other kind is rejected, and one bad entry rejects the
		 * whole manifest.
		 *
		 * Normalised to upper case here, the way hashes are lowered: the catalogue
		 * indexes it upper case, and a raw lowercase code would fall through to a
		 * name match without a word.
		 */
		serial: z
			.string()
			.regex(/^[A-Za-z0-9]{4}$/)
			.transform((s) => s.toUpperCase())
			.optional(),
		discNumber: z.number().int().nonnegative().optional(),
		discVersion: z.number().int().nonnegative().optional(),
		/**
		 * Name of the entry inside the archive, when the file is a container.
		 * Crosses the same trust boundary as `path` and reaches an extraction
		 * command as an argument, so it gets the same guard.
		 */
		innerName: safeFsPath.optional(),
	})
	.superRefine((entry, ctx) => {
		if (entry.rawSha1 !== undefined && entry.kind !== 'chd') {
			ctx.addIssue({
				code: 'custom',
				path: ['rawSha1'],
				message: 'rawSha1 only applies to kind "chd"',
			})
		}
		// The three disc-header fields are read by the same strategy and share
		// one rule: they exist only where a disc header does.
		if (entry.kind !== 'rvz') {
			for (const field of ['serial', 'discNumber', 'discVersion'] as const) {
				if (entry[field] !== undefined) {
					ctx.addIssue({
						code: 'custom',
						path: [field],
						message: `${field} only applies to kind "rvz"`,
					})
				}
			}
		}
	})

export type ManifestEntry = z.infer<typeof manifestEntrySchema>

export function parseManifest(input: unknown): ManifestEntry[] {
	return z.array(manifestEntrySchema).parse(input)
}

export type LenientManifest = { entries: ManifestEntry[]; rejected: number }

/**
 * Per-entry validation, for the HTTP boundary.
 *
 * `parseManifest` is all-or-nothing, which is the right contract for a local
 * scan: one malformed entry means the scanner is broken and should be seen. Over
 * HTTP it is the wrong one — a single odd entry pushed by a remote box would
 * discard that system's whole scan. Here the bad entries are dropped and
 * counted, so the caller can report them without losing the rest.
 */
export function parseManifestLenient(input: unknown): LenientManifest {
	if (!Array.isArray(input)) return { entries: [], rejected: 0 }

	const entries: ManifestEntry[] = []
	let rejected = 0
	for (const raw of input) {
		const parsed = manifestEntrySchema.safeParse(raw)
		if (parsed.success) entries.push(parsed.data)
		else rejected++
	}
	return { entries, rejected }
}
