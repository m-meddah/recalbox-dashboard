import { deflateSync } from 'node:zlib'
import type { RomFileRow } from '@/lib/db/rom-audit-queries'

/**
 * Kinds the incremental cache covers.
 *
 * Deliberately just the two that read the file in full — a bare ROM and an
 * arcade container. Every other strategy is already nearly free: a zip's central
 * directory and a CHD or RVZ header cost a couple of hundred bytes, so caching
 * them would buy nothing.
 *
 * There is a second, harder reason. `rom_files` stores neither `rawSha1` (CHD)
 * nor `discNumber` / `discVersion` (RVZ), so a cache rebuilt from the database
 * would silently drop them and degrade the serial matching on every rescan.
 * `raw` and `container` carry a CRC32 and nothing else, so they rebuild exactly.
 */
export const CACHEABLE_KINDS = ['raw', 'container'] as const
export type CacheableKind = (typeof CACHEABLE_KINDS)[number]

export type ScanCacheEntry = {
	size: number
	mtime: number
	crc32: string
	kind: CacheableKind
}

/** Indexed by absolute path: one cacheable file yields exactly one entry. */
export type ScanCache = Record<string, ScanCacheEntry>

/**
 * Guard against a degenerate payload. Measured on the reference box, an exec
 * stdin carried 2,3 MB (120 000 entries) intact, so this is a safety net and not
 * a transport limit — the 8000-byte budget applies to the command line only.
 */
export const MAX_CACHE_BYTES = 3_000_000

/** The previous scan of a system, reduced to what lets the scanner skip a read. */
export function buildScanCache(rows: readonly RomFileRow[]): ScanCache {
	const cache: ScanCache = {}
	for (const row of rows) {
		if (!row.crc32) continue
		if (!(CACHEABLE_KINDS as readonly string[]).includes(row.kind)) continue
		cache[row.path] = {
			size: row.size,
			mtime: row.mtime,
			crc32: row.crc32,
			kind: row.kind as CacheableKind,
		}
	}
	return cache
}

export type EncodedCache =
	| { status: 'ok'; payload: string }
	| { status: 'too-large'; bytes: number }

/**
 * Packs the cache for the trip to the box: JSON, deflated, base64. It rides in
 * the program text on the exec's stdin, so it must survive as a Python string
 * literal — base64 guarantees that without any escaping.
 */
export function encodeScanCache(cache: ScanCache): EncodedCache {
	const payload = deflateSync(Buffer.from(JSON.stringify(cache), 'utf-8')).toString('base64')
	if (payload.length > MAX_CACHE_BYTES) return { status: 'too-large', bytes: payload.length }
	return { status: 'ok', payload }
}

/**
 * Prepends the cache to the scan script.
 *
 * The script guards its own `CACHE_B64` with a `try/except NameError`, so an
 * assignment placed before it wins and the script still runs standalone with no
 * cache at all.
 */
export function withScanCache(script: string, encoded: string): string {
	return `CACHE_B64 = '${encoded}'\n${script}`
}
