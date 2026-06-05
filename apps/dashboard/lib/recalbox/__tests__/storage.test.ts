import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { afterEach, describe, expect, it, vi } from 'vitest'

function mockFetch(json: unknown, ok = true) {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => json }))
}

afterEach(() => vi.unstubAllGlobals())

const SAMPLE = {
	storages: {
		'0': {
			recalbox: 'share',
			mount: '/recalbox/share/externals/usb1',
			filesystem: '/dev/sdb1',
			filesystemtype: 'exfat',
			label: 'Gaming_Drv',
			size: 1000,
			used: 880,
		},
		'1': {
			recalbox: 'boot',
			mount: '/boot',
			filesystem: '/dev/mmcblk0p1',
			filesystemtype: 'vfat',
			label: 'RECALBOX',
			size: 1000,
			used: 240,
		},
		// duplicate of the share partition under a different mount — must be de-duped
		'2': {
			recalbox: 'share',
			mount: '/recalbox/share/externals/usb1/again',
			filesystem: '/dev/sdb1',
			filesystemtype: 'exfat',
			label: 'Gaming_Drv',
			size: 1000,
			used: 880,
		},
		// internal mounts that the Web Manager hides
		'3': {
			recalbox: 'unknown',
			mount: '/overlay/lower',
			filesystem: 'overlay',
			filesystemtype: 'squashfs',
			size: 500,
			used: 500,
		},
		'4': {
			recalbox: 'system',
			mount: '/',
			filesystem: 'overlay',
			filesystemtype: 'overlay',
			size: 500,
			used: 100,
		},
		'5': {
			recalbox: 'unknown',
			mount: '/dev',
			filesystem: 'devtmpfs',
			filesystemtype: 'devtmpfs',
			size: 0,
			used: 0,
		},
	},
}

describe('fetchStorageInfo', () => {
	it('keeps only the user-facing share/boot partitions', async () => {
		mockFetch(SAMPLE)
		const out = await fetchStorageInfo('recalbox.local')
		expect(out.map((s) => s.label).sort()).toEqual(['Gaming_Drv', 'RECALBOX'])
	})

	it('de-duplicates identical filesystems and computes percent', async () => {
		mockFetch(SAMPLE)
		const out = await fetchStorageInfo('recalbox.local')
		const drv = out.filter((s) => s.label === 'Gaming_Drv')
		expect(drv).toHaveLength(1)
		expect(drv[0]!.percent).toBe(88)
	})

	it('sorts by usage percent descending', async () => {
		mockFetch(SAMPLE)
		const out = await fetchStorageInfo('recalbox.local')
		expect(out.map((s) => s.label)).toEqual(['Gaming_Drv', 'RECALBOX'])
		expect(out[0]!.percent).toBeGreaterThanOrEqual(out[1]!.percent)
	})

	it('returns [] on a non-ok response', async () => {
		mockFetch({}, false)
		expect(await fetchStorageInfo('recalbox.local')).toEqual([])
	})

	it('returns [] when fetch throws', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
		expect(await fetchStorageInfo('recalbox.local')).toEqual([])
	})
})
