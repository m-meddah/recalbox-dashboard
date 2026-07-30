import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/recalbox/storage', () => ({ fetchStorageInfo: vi.fn() }))

import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { EXTERNALS_ROOT, discoverScanTargets } from '../discover'

const mounts = [{ mount: '/recalbox/share' }, { mount: '/recalbox/share/externals/usb0' }]

beforeEach(() => {
	vi.mocked(fetchStorageInfo).mockResolvedValue(mounts as never)
})

/** A box whose externals directory holds exactly `entries`. */
function boxWith(entries: string[], systems: string[] = ['snes', 'psx']) {
	return vi.fn(async (root: string) => {
		if (root === EXTERNALS_ROOT) return entries
		return systems
	})
}

describe('discoverScanTargets', () => {
	it('lists the roms directories of every share', async () => {
		const listDirs = boxWith(['usb0'])
		const res = await discoverScanTargets('recalbox.local', listDirs)
		expect(listDirs).toHaveBeenCalledWith('/recalbox/share/roms')
		expect(listDirs).toHaveBeenCalledWith('/recalbox/share/externals/usb0/recalbox/roms')
		expect(res.targets).toHaveLength(4)
		expect(res.unreadable).toEqual([])
	})

	it('restricts to the requested systems', async () => {
		const res = await discoverScanTargets('recalbox.local', boxWith(['usb0']), ['psx'])
		expect(res.targets.every((t) => t.system === 'psx')).toBe(true)
		expect(res.targets).toHaveLength(2)
	})

	// A share that cannot be listed must not take the whole discovery down.
	it('skips a share whose listing fails', async () => {
		const listDirs = vi.fn(async (root: string) => {
			if (root === EXTERNALS_ROOT) return ['usb0']
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

	it('returns nothing when the box reports and holds nothing', async () => {
		vi.mocked(fetchStorageInfo).mockResolvedValue([] as never)
		const res = await discoverScanTargets('recalbox.local', boxWith([]))
		expect(res.targets).toEqual([])
		expect(res.mounts).toBe(0)
	})
})

// Recalbox mounts a NAS at /recalbox/share/externals/network0…network3. The
// monitoring API describes partitions — it does not describe a network share the
// way it describes /dev/sdb1 — so relying on it alone would make the SSH
// transport ignore an entire NAS while the on-box agent, which enumerates the
// directory, scanned it. The two must agree.
describe('discoverScanTargets (NAS and extra supports)', () => {
	it('finds a network share the monitoring api never reported', async () => {
		const listDirs = boxWith(['usb0', 'network0'])
		const res = await discoverScanTargets('recalbox.local', listDirs)
		const found = [...new Set(res.targets.map((t) => t.mount))]
		expect(found).toContain('/recalbox/share/externals/network0')
		expect(listDirs).toHaveBeenCalledWith('/recalbox/share/externals/network0/recalbox/roms')
	})

	it('builds the roms root of a network share like any other external', async () => {
		const res = await discoverScanTargets('recalbox.local', boxWith(['network2'], ['snes']))
		const target = res.targets.find((t) => t.mount === '/recalbox/share/externals/network2')
		expect(target?.romsPath).toBe('/recalbox/share/externals/network2/recalbox/roms/snes')
	})

	// Nothing matches on "usb", so usb2/usb3 and any future naming come for free.
	it('covers usb2 and usb3, which the monitoring api may not report either', async () => {
		const res = await discoverScanTargets('recalbox.local', boxWith(['usb2', 'usb3'], ['snes']))
		const found = [...new Set(res.targets.map((t) => t.mount))]
		expect(found).toContain('/recalbox/share/externals/usb2')
		expect(found).toContain('/recalbox/share/externals/usb3')
	})

	// The Web Manager already reports usb0; enumerating must not scan it twice.
	it('does not duplicate a support reported by both sources', async () => {
		const res = await discoverScanTargets('recalbox.local', boxWith(['usb0'], ['snes']))
		const usb0 = res.targets.filter((t) => t.mount === '/recalbox/share/externals/usb0')
		expect(usb0).toHaveLength(1)
	})

	// An external with no `recalbox/roms` is a plain data disk, not a failure.
	it('ignores an external that holds no roms directory', async () => {
		const listDirs = vi.fn(async (root: string) => {
			if (root === EXTERNALS_ROOT) return ['usb0', 'backup']
			if (root.includes('backup')) return []
			return ['snes']
		})
		const res = await discoverScanTargets('recalbox.local', listDirs)
		expect(res.targets.some((t) => t.mount.includes('backup'))).toBe(false)
		expect(res.unreadable).toEqual([])
	})

	it('ignores a hidden entry of the externals directory', async () => {
		const res = await discoverScanTargets(
			'recalbox.local',
			boxWith(['.Trash-1000', 'network1'], ['snes']),
		)
		const found = [...new Set(res.targets.map((t) => t.mount))]
		expect(found).not.toContain('/recalbox/share/externals/.Trash-1000')
		expect(found).toContain('/recalbox/share/externals/network1')
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
		// The externals root plus each reported share.
		expect(res.unreadable).toContain(EXTERNALS_ROOT)
		expect(res.unreadable.length).toBeGreaterThan(1)
		expect(res.error).toContain('authentication')
	})
})
