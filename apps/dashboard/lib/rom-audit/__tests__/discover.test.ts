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
		const res = await discoverScanTargets('recalbox.local', listDirs)
		expect(listDirs).toHaveBeenCalledWith('/recalbox/share/roms')
		expect(listDirs).toHaveBeenCalledWith('/recalbox/share/externals/usb0/recalbox/roms')
		expect(res.targets).toHaveLength(4)
		expect(res.unreadable).toEqual([])
	})

	it('restricts to the requested systems', async () => {
		const res = await discoverScanTargets('recalbox.local', async () => ['snes', 'psx'], ['psx'])
		expect(res.targets.every((t) => t.system === 'psx')).toBe(true)
		expect(res.targets).toHaveLength(2)
	})

	// A share that cannot be listed must not take the whole discovery down.
	it('skips a share whose listing fails', async () => {
		const listDirs = vi.fn(async (root: string) => {
			if (root.includes('usb0')) throw new Error('permission denied')
			return ['snes']
		})
		const res = await discoverScanTargets('recalbox.local', listDirs)
		expect(res.targets).toHaveLength(1)
		expect(res.targets[0]?.mount).toBe('/recalbox/share')
		// Reported, not swallowed: the caller must be able to say what failed.
		expect(res.unreadable).toEqual(['/recalbox/share/externals/usb0/recalbox/roms'])
		expect(res.error).toContain('permission denied')
	})

	it('returns nothing when no share is reported', async () => {
		vi.mocked(fetchStorageInfo).mockResolvedValue([] as never)
		const res = await discoverScanTargets('recalbox.local', async () => ['snes'])
		expect(res.targets).toEqual([])
		expect(res.mounts).toBe(0)
	})
})

// Found by running the dev server against a box whose stored SSH password was
// empty: every listing threw, discovery returned nothing, and the route answered
// "no scannable directory" — sending the reader after a collection problem that
// did not exist.
describe('discoverScanTargets (every share unreadable)', () => {
	it('reports the failure instead of looking like an empty collection', async () => {
		const res = await discoverScanTargets('recalbox.local', async () => {
			throw new Error('All configured authentication methods failed')
		})
		expect(res.targets).toEqual([])
		expect(res.mounts).toBeGreaterThan(0)
		expect(res.unreadable).toHaveLength(2)
		expect(res.error).toContain('authentication')
	})
})
