import { SYSTEM_META } from '@/lib/recalbox/system-meta'
import { describe, expect, it } from 'vitest'
import { catalogForSystem } from '../system-catalog'

describe('catalogForSystem', () => {
	it('maps snes to its no-intro dat', () => {
		expect(catalogForSystem('snes')).toEqual({
			source: 'no-intro',
			file: 'Nintendo - Super Nintendo Entertainment System.dat',
			hashMode: 'content',
			ssConsoleId: 4,
		})
	})

	it('maps gamecube to its redump dat', () => {
		expect(catalogForSystem('gamecube')?.source).toBe('redump')
		expect(catalogForSystem('gamecube')?.file).toBe('Nintendo - GameCube.dat')
	})

	it('maps wii to its redump dat', () => {
		expect(catalogForSystem('wii')?.source).toBe('redump')
	})

	it('returns null for a system with no catalogue', () => {
		expect(catalogForSystem('amiga600')).toBeNull()
	})

	it('returns null for an unknown system', () => {
		expect(catalogForSystem('nope')).toBeNull()
	})

	it('never declares a dat file without a source', () => {
		for (const [id, meta] of Object.entries(SYSTEM_META)) {
			if (meta.datFile) expect(meta.datSource, id).toBeDefined()
			if (meta.datSource) expect(meta.datFile, id).toBeDefined()
		}
	})
})

// The arcade catalogues hash the archive itself, so their systems must be
// scanned in a different mode from every cartridge and disc system.
describe('catalogForSystem (arcade)', () => {
	it('maps mame to its dat, in container mode', () => {
		expect(catalogForSystem('mame')).toEqual({
			source: 'mame',
			file: 'MAME.dat',
			hashMode: 'container',
		})
	})

	it('maps fbneo to its own dat, under the fbneo-split directory', () => {
		const catalog = catalogForSystem('fbneo')
		expect(catalog?.source).toBe('fbneo-split')
		expect(catalog?.file).toBe('FBNeo - Arcade Games.dat')
		expect(catalog?.hashMode).toBe('container')
	})

	it('maps neogeo in container mode', () => {
		expect(catalogForSystem('neogeo')?.hashMode).toBe('container')
	})

	// Everything that is not arcade keeps hashing the ROM inside the archive:
	// the whole of lots 1, 2A and 2B depends on it.
	it('defaults every other system to content mode', () => {
		for (const system of ['snes', 'psx', 'gamecube', 'gamegear']) {
			expect(catalogForSystem(system)?.hashMode).toBe('content')
		}
	})
})
