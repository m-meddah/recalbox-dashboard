import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/recalbox/storage', () => ({ fetchStorageInfo: vi.fn() }))

import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { discoverScanTargets } from '../discover'

const mounts = [{ mount: '/recalbox/share' }, { mount: '/recalbox/share/externals/usb0' }]

beforeEach(() => {
	vi.mocked(fetchStorageInfo).mockResolvedValue(mounts as never)
})

describe('discoverScanTargets', () => {
	it('lists the roms directories of every share', async () => {
		const listDirs = vi.fn(async () => ['snes', 'psx'])
		const targets = await discoverScanTargets('recalbox.local', listDirs)
		expect(listDirs).toHaveBeenCalledWith('/recalbox/share/roms')
		expect(listDirs).toHaveBeenCalledWith('/recalbox/share/externals/usb0/recalbox/roms')
		expect(targets).toHaveLength(4)
	})

	it('restricts to the requested systems', async () => {
		const targets = await discoverScanTargets('recalbox.local', async () => ['snes', 'psx'], [
			'psx',
		])
		expect(targets.every((t) => t.system === 'psx')).toBe(true)
		expect(targets).toHaveLength(2)
	})

	// A share that cannot be listed must not take the whole discovery down.
	it('skips a share whose listing fails', async () => {
		const listDirs = vi.fn(async (root: string) => {
			if (root.includes('usb0')) throw new Error('permission denied')
			return ['snes']
		})
		const targets = await discoverScanTargets('recalbox.local', listDirs)
		expect(targets).toHaveLength(1)
		expect(targets[0]?.mount).toBe('/recalbox/share')
	})

	it('returns nothing when no share is reported', async () => {
		vi.mocked(fetchStorageInfo).mockResolvedValue([] as never)
		expect(await discoverScanTargets('recalbox.local', async () => ['snes'])).toEqual([])
	})
})
