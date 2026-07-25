import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from '@/lib/logger'
import { type Dat, parseDat } from './dat-parser'
import { catalogForSystem } from './system-catalog'

const BASE_URL = 'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export type CachedDat = { text: string; etag?: string; fetchedAt: number }

/**
 * Why there is no dat, when there is none. "This system has no reference
 * catalogue" is a valid, permanent state — 23 of the 78 systems are in it — and
 * a caller must be able to say so instead of blaming a network it never used.
 */
export type CatalogResult =
	| { status: 'no-catalog' }
	| { status: 'ok'; dat: Dat }
	| { status: 'unavailable' }

export type CatalogDeps = {
	now: () => number
	read: (key: string) => Promise<CachedDat | null>
	write: (key: string, value: CachedDat) => Promise<void>
	fetchDat: (url: string, etag?: string) => Promise<{ status: number; text: string; etag?: string }>
}

function cacheDir(): string {
	return path.resolve(process.env.ROM_AUDIT_CACHE_DIR ?? path.join(process.cwd(), '.dat-cache'))
}

const fileDeps: CatalogDeps = {
	now: () => Date.now(),
	read: async (key) => {
		try {
			return JSON.parse(await readFile(path.join(cacheDir(), `${key}.json`), 'utf-8')) as CachedDat
		} catch {
			return null
		}
	},
	write: async (key, value) => {
		const dest = path.join(cacheDir(), `${key}.json`)
		await mkdir(path.dirname(dest), { recursive: true })
		await writeFile(dest, JSON.stringify(value))
	},
	fetchDat: async (url, etag) => {
		const res = await fetch(url, { headers: etag ? { 'If-None-Match': etag } : {} })
		return {
			status: res.status,
			text: res.status === 200 ? await res.text() : '',
			etag: res.headers.get('etag') ?? undefined,
		}
	},
}

/** Cache key for a system's dat — safe for both a filename and an object-storage key. */
function cacheKey(source: string, file: string): string {
	return `${source}__${file.replace(/[^a-zA-Z0-9.-]/g, '_')}`
}

/**
 * Writes the cache without ever failing the call. The catalogue is already in
 * hand when this runs, so a write error is a lost speed-up, not a lost result —
 * serverless deployments run on a read-only filesystem where mkdir raises
 * EROFS on every single attempt.
 */
async function cache(deps: CatalogDeps, key: string, value: CachedDat): Promise<void> {
	try {
		await deps.write(key, value)
	} catch (err) {
		logger.warn(`rom-audit: dat cache write failed for ${key}: ${String(err)}`)
	}
}

/**
 * The reference DAT for a system, from cache when fresh, revalidated with the
 * stored ETag when stale. The three outcomes are distinguished: the system has
 * no catalogue at all, the catalogue is here, or the network failed with
 * nothing cached to fall back on.
 */
export async function loadDatForSystem(
	system: string,
	deps: CatalogDeps = fileDeps,
): Promise<CatalogResult> {
	const catalog = catalogForSystem(system)
	if (!catalog) return { status: 'no-catalog' }

	const key = cacheKey(catalog.source, catalog.file)
	const url = `${BASE_URL}/${catalog.source}/${encodeURIComponent(catalog.file)}`
	const cached = await deps.read(key)

	if (cached && deps.now() - cached.fetchedAt < TTL_MS) {
		return { status: 'ok', dat: parseDat(cached.text) }
	}

	try {
		const res = await deps.fetchDat(url, cached?.etag)
		if (res.status === 304 && cached) {
			const dat = parseDat(cached.text)
			await cache(deps, key, { ...cached, fetchedAt: deps.now() })
			return { status: 'ok', dat }
		}
		if (res.status === 200) {
			const dat = parseDat(res.text)
			await cache(deps, key, { text: res.text, etag: res.etag, fetchedAt: deps.now() })
			return { status: 'ok', dat }
		}
		logger.warn(`rom-audit: unexpected status ${res.status} for ${catalog.file}`)
	} catch (err) {
		logger.warn(`rom-audit: dat fetch failed for ${catalog.file}: ${String(err)}`)
	}

	// Stale is better than nothing — the catalogue moves slowly.
	if (cached) return { status: 'ok', dat: parseDat(cached.text) }
	return { status: 'unavailable' }
}
