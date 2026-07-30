import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CachedDat, CatalogResult } from '../catalog'
import { loadDatForSystem } from '../catalog'
import type { Dat } from '../dat-parser'

const DAT_TEXT = readFileSync(join(__dirname, '__fixtures__', 'no-intro-snes.dat'), 'utf-8')

/** The parsed dat of a successful load, refusing anything else loudly. */
function okDat(result: CatalogResult): Dat {
	if (result.status !== 'ok') throw new Error(`expected an ok catalogue, got "${result.status}"`)
	return result.dat
}

// Seule l'horloge s'injecte ici : les autres dépendances sont des mocks qu'on
// réassigne après coup, pour garder leur typage `Mock` et donc `mockClear()`.
// Le type reflète volontairement ce contrat, sinon un `deps({ write })` serait
// accepté puis ignoré en silence.
function deps(over: { now?: () => number } = {}) {
	const store = new Map<string, CachedDat>()
	return {
		now: over.now ?? (() => 0),
		read: vi.fn(async (key: string) => store.get(key) ?? null),
		write: vi.fn(async (key: string, value: CachedDat) => {
			store.set(key, value)
		}),
		fetchDat: vi.fn(
			async (): Promise<{ status: number; text: string; etag: string | undefined }> => ({
				status: 200,
				text: DAT_TEXT,
				etag: 'W/"abc"',
			}),
		),
	}
}

describe('loadDatForSystem', () => {
	it('fetches and parses on a cold cache', async () => {
		const d = deps()
		const res = await loadDatForSystem('snes', d)
		expect(okDat(res).games).toHaveLength(4)
		expect(d.fetchDat).toHaveBeenCalledOnce()
		expect(d.write).toHaveBeenCalledOnce()
	})

	it('serves from cache without any network call when fresh', async () => {
		const d = deps()
		await loadDatForSystem('snes', d)
		d.fetchDat.mockClear()
		const res = await loadDatForSystem('snes', d)
		expect(okDat(res).games).toHaveLength(4)
		expect(d.fetchDat).not.toHaveBeenCalled()
	})

	it('revalidates with the stored etag once the cache is stale', async () => {
		const d = deps({ now: () => 0 })
		await loadDatForSystem('snes', d)
		const stale = { ...d, now: () => 8 * 24 * 60 * 60 * 1000 }
		stale.fetchDat = vi.fn(async () => ({ status: 304, text: '', etag: 'W/"abc"' }))
		const res = await loadDatForSystem('snes', stale)
		expect(stale.fetchDat).toHaveBeenCalledWith(expect.any(String), 'W/"abc"')
		expect(okDat(res).games).toHaveLength(4)
	})

	// "this system has no reference catalogue" is a perfectly valid state — 23 of
	// the 78 systems are in it — and must not read like a failure to the caller.
	it('reports no-catalog for a system that has none', async () => {
		expect(await loadDatForSystem('amiga600', deps())).toEqual({ status: 'no-catalog' })
	})

	it('falls back to the stale cache when the network fails', async () => {
		const d = deps()
		await loadDatForSystem('snes', d)
		const broken = { ...d, now: () => 8 * 24 * 60 * 60 * 1000 }
		broken.fetchDat = vi.fn(async () => {
			throw new Error('offline')
		})
		const res = await loadDatForSystem('snes', broken)
		expect(okDat(res).games).toHaveLength(4)
	})

	it('reports unavailable when the network fails and nothing is cached', async () => {
		const d = deps()
		d.fetchDat = vi.fn(async () => {
			throw new Error('offline')
		})
		expect(await loadDatForSystem('snes', d)).toEqual({ status: 'unavailable' })
	})

	it('serves the stale cache on an unexpected http status', async () => {
		const d = deps()
		await loadDatForSystem('snes', d)
		const broken = { ...d, now: () => 8 * 24 * 60 * 60 * 1000 }
		broken.fetchDat = vi.fn(async () => ({ status: 500, text: '', etag: undefined }))
		const res = await loadDatForSystem('snes', broken)
		expect(okDat(res).games).toHaveLength(4)
		expect(broken.fetchDat).toHaveBeenCalledOnce()
	})

	it('reports unavailable on an unexpected http status with nothing cached', async () => {
		const d = deps()
		d.fetchDat = vi.fn(async () => ({ status: 500, text: '', etag: undefined }))
		expect(await loadDatForSystem('snes', d)).toEqual({ status: 'unavailable' })
	})

	// Serverless deployments run on a read-only filesystem: mkdir raises EROFS on
	// every write. Losing the cache is a slowdown; losing the catalogue we already
	// hold in memory would report every system as "no catalogue".
	it('returns the freshly fetched catalogue even when the cache write fails', async () => {
		const d = deps()
		d.write = vi.fn(async () => {
			throw new Error('EROFS: read-only file system')
		})
		const res = await loadDatForSystem('snes', d)
		expect(okDat(res).games).toHaveLength(4)
	})

	it('returns the revalidated cache even when refreshing its timestamp fails', async () => {
		const d = deps()
		await loadDatForSystem('snes', d)
		const readonly = { ...d, now: () => 8 * 24 * 60 * 60 * 1000 }
		readonly.fetchDat = vi.fn(async () => ({ status: 304, text: '', etag: 'W/"abc"' }))
		readonly.write = vi.fn(async () => {
			throw new Error('EROFS: read-only file system')
		})
		const res = await loadDatForSystem('snes', readonly)
		expect(okDat(res).games).toHaveLength(4)
	})
})
