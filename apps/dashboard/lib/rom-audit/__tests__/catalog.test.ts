import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CachedDat } from '../catalog'
import { loadDatForSystem } from '../catalog'

const DAT_TEXT = readFileSync(join(__dirname, '__fixtures__', 'no-intro-snes.dat'), 'utf-8')

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
		const dat = await loadDatForSystem('snes', d)
		expect(dat?.games).toHaveLength(4)
		expect(d.fetchDat).toHaveBeenCalledOnce()
		expect(d.write).toHaveBeenCalledOnce()
	})

	it('serves from cache without any network call when fresh', async () => {
		const d = deps()
		await loadDatForSystem('snes', d)
		d.fetchDat.mockClear()
		const dat = await loadDatForSystem('snes', d)
		expect(dat?.games).toHaveLength(4)
		expect(d.fetchDat).not.toHaveBeenCalled()
	})

	it('revalidates with the stored etag once the cache is stale', async () => {
		const d = deps({ now: () => 0 })
		await loadDatForSystem('snes', d)
		const stale = { ...d, now: () => 8 * 24 * 60 * 60 * 1000 }
		stale.fetchDat = vi.fn(async () => ({ status: 304, text: '', etag: 'W/"abc"' }))
		const dat = await loadDatForSystem('snes', stale)
		expect(stale.fetchDat).toHaveBeenCalledWith(expect.any(String), 'W/"abc"')
		expect(dat?.games).toHaveLength(4)
	})

	it('returns null for a system without a catalogue', async () => {
		expect(await loadDatForSystem('amiga600', deps())).toBeNull()
	})

	it('falls back to the stale cache when the network fails', async () => {
		const d = deps()
		await loadDatForSystem('snes', d)
		const broken = { ...d, now: () => 8 * 24 * 60 * 60 * 1000 }
		broken.fetchDat = vi.fn(async () => {
			throw new Error('offline')
		})
		const dat = await loadDatForSystem('snes', broken)
		expect(dat?.games).toHaveLength(4)
	})

	it('returns null when the network fails and nothing is cached', async () => {
		const d = deps()
		d.fetchDat = vi.fn(async () => {
			throw new Error('offline')
		})
		expect(await loadDatForSystem('snes', d)).toBeNull()
	})

	it('serves the stale cache on an unexpected http status', async () => {
		const d = deps()
		await loadDatForSystem('snes', d)
		const broken = { ...d, now: () => 8 * 24 * 60 * 60 * 1000 }
		broken.fetchDat = vi.fn(async () => ({ status: 500, text: '', etag: undefined }))
		const dat = await loadDatForSystem('snes', broken)
		expect(dat?.games).toHaveLength(4)
		expect(broken.fetchDat).toHaveBeenCalledOnce()
	})

	it('returns null on an unexpected http status with nothing cached', async () => {
		const d = deps()
		d.fetchDat = vi.fn(async () => ({ status: 500, text: '', etag: undefined }))
		expect(await loadDatForSystem('snes', d)).toBeNull()
	})
})
