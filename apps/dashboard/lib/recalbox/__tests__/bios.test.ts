import { fetchBiosInfo } from '@/lib/recalbox/bios'
import { afterEach, describe, expect, it, vi } from 'vitest'

function mockFetch(json: unknown, ok = true) {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => json }))
}

afterEach(() => vi.unstubAllGlobals())

const SAMPLE = {
	snes: {
		fullName: 'Super Nintendo',
		scanResult: {},
		biosList: {
			'snes/ok.bin': {
				mandatory: true,
				displayFileName: 'snes/ok.bin',
				currentMd5: 'abc123',
				md5List: ['abc123'],
				lightStatus: 'Green',
				realStatus: 'HashMatching',
				notes: 'fine',
			},
			'snes/wrong.bin': {
				mandatory: true,
				displayFileName: 'snes/wrong.bin',
				currentMd5: 'deadbeef',
				md5List: ['cafe'],
				lightStatus: 'Yellow',
				realStatus: 'HashNotMatching',
			},
			'snes/missing.bin': {
				mandatory: true,
				displayFileName: 'snes/missing.bin',
				currentMd5: '00000000000000000000000000000000',
				md5List: ['feed'],
				lightStatus: 'Red',
				realStatus: 'FileNotFound',
			},
		},
	},
	amiga: {
		fullName: 'Amiga',
		biosList: {
			'amiga/opt.rom': {
				displayFileName: 'amiga/opt.rom',
				currentMd5: 'aaa',
				md5List: ['aaa'],
				lightStatus: 'Green',
				realStatus: 'HashMatching',
			},
		},
	},
}

describe('fetchBiosInfo', () => {
	it('flattens systems and maps light/real status to ok/mismatch/missing', async () => {
		mockFetch(SAMPLE)
		const { entries } = await fetchBiosInfo('recalbox.local')
		const byPath = Object.fromEntries(entries.map((e) => [e.path, e]))
		expect(byPath['snes/ok.bin']!.status).toBe('ok')
		expect(byPath['snes/wrong.bin']!.status).toBe('mismatch')
		expect(byPath['snes/missing.bin']!.status).toBe('missing')
	})

	it('uppercases md5s and blanks the all-zero (not-found) hash', async () => {
		mockFetch(SAMPLE)
		const { entries } = await fetchBiosInfo('recalbox.local')
		// biome-ignore lint/style/noNonNullAssertion: test data guarantees this entry exists
		const ok = entries.find((e) => e.path === 'snes/ok.bin')!
		expect(ok.currentMd5).toBe('ABC123')
		expect(ok.expectedMd5).toEqual(['ABC123'])
		expect(entries.find((e) => e.path === 'snes/missing.bin')?.currentMd5).toBe('')
	})

	it('defaults mandatory to false when absent', async () => {
		mockFetch(SAMPLE)
		const { entries } = await fetchBiosInfo('recalbox.local')
		expect(entries.find((e) => e.path === 'amiga/opt.rom')?.mandatory).toBe(false)
	})

	it('sorts by system name then path', async () => {
		mockFetch(SAMPLE)
		const { entries } = await fetchBiosInfo('recalbox.local')
		expect(entries.map((e) => e.path)).toEqual([
			'amiga/opt.rom',
			'snes/missing.bin',
			'snes/ok.bin',
			'snes/wrong.bin',
		])
	})

	it('computes the summary counts', async () => {
		mockFetch(SAMPLE)
		const { summary } = await fetchBiosInfo('recalbox.local')
		expect(summary).toEqual({ total: 4, ok: 2, mismatch: 1, missing: 1 })
	})

	it('returns an empty report on a non-ok response', async () => {
		mockFetch({}, false)
		expect(await fetchBiosInfo('recalbox.local')).toEqual({
			entries: [],
			summary: { total: 0, ok: 0, mismatch: 0, missing: 0 },
		})
	})

	it('returns an empty report when fetch throws', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
		const { entries, summary } = await fetchBiosInfo('recalbox.local')
		expect(entries).toEqual([])
		expect(summary.total).toBe(0)
	})
})
