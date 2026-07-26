import type { StorageMount } from '@/lib/recalbox/storage'
import { describe, expect, it } from 'vitest'
import { buildScanTargets, mountForPath, romsRootFor } from '../scan-targets'

function mount(path: string): StorageMount {
	return { label: path, mount: path, usedBytes: 0, sizeBytes: 1, percent: 0 }
}

// Les trois supports réels de la box de référence.
const SD = '/recalbox/share'
const USB0 = '/recalbox/share/externals/usb0'
const USB1 = '/recalbox/share/externals/usb1'

describe('romsRootFor', () => {
	it('puts the sd card roms directly under the mount', () => {
		expect(romsRootFor(SD)).toBe('/recalbox/share/roms')
	})

	it('inserts the recalbox directory on an external disk', () => {
		expect(romsRootFor(USB0)).toBe('/recalbox/share/externals/usb0/recalbox/roms')
	})
})

describe('buildScanTargets', () => {
	it('produces one target per system directory', () => {
		const targets = buildScanTargets([mount(SD)], {
			'/recalbox/share/roms': ['snes', 'megadrive'],
		})
		expect(targets).toEqual([
			{ mount: SD, system: 'snes', romsPath: '/recalbox/share/roms/snes' },
			{ mount: SD, system: 'megadrive', romsPath: '/recalbox/share/roms/megadrive' },
		])
	})

	it('covers every mount it is given', () => {
		const targets = buildScanTargets([mount(SD), mount(USB0)], {
			'/recalbox/share/roms': ['snes'],
			'/recalbox/share/externals/usb0/recalbox/roms': ['psx'],
		})
		expect(targets.map((t) => t.mount)).toEqual([SD, USB0])
		expect(targets.map((t) => t.system)).toEqual(['snes', 'psx'])
	})

	// Un dossier rempli mais jamais scrapé n'a pas de gamelist.xml. C'est
	// précisément un cas que l'audit doit révéler, pas masquer.
	it('does not require a gamelist to include a system', () => {
		const targets = buildScanTargets([mount(SD)], { '/recalbox/share/roms': ['jamaisscrape'] })
		expect(targets).toHaveLength(1)
	})

	it('skips hidden directories and ports', () => {
		const targets = buildScanTargets([mount(SD)], {
			'/recalbox/share/roms': ['.hidden', 'ports', 'snes'],
		})
		expect(targets.map((t) => t.system)).toEqual(['snes'])
	})

	it('yields nothing for a mount with no listing', () => {
		expect(buildScanTargets([mount(SD)], {})).toEqual([])
	})
})

describe('mountForPath', () => {
	const mounts = [SD, USB0, USB1]

	// Sans la règle du préfixe le plus long, toute la collection des disques
	// externes serait attribuée à la carte SD, qui en est le préfixe.
	it('picks the longest matching mount, not the first', () => {
		expect(mountForPath(`${USB0}/recalbox/roms/snes/game.zip`, mounts)).toBe(USB0)
		expect(mountForPath(`${USB1}/recalbox/roms/psx/game.chd`, mounts)).toBe(USB1)
	})

	it('still resolves a file that really is on the sd card', () => {
		expect(mountForPath('/recalbox/share/roms/snes/game.zip', mounts)).toBe(SD)
	})

	it('matches the mount itself', () => {
		expect(mountForPath(SD, mounts)).toBe(SD)
	})

	// Un préfixe qui ne s'arrête pas sur une frontière de segment n'en est pas un.
	it('does not match a sibling whose name merely starts the same', () => {
		expect(mountForPath('/recalbox/shareX/roms/snes/game.zip', mounts)).toBeNull()
	})

	it('returns null for a path under no mount', () => {
		expect(mountForPath('/tmp/game.zip', mounts)).toBeNull()
	})
})
