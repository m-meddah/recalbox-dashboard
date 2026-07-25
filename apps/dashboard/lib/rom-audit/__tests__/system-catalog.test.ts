import { SYSTEM_META } from '@/lib/recalbox/system-meta'
import { describe, expect, it } from 'vitest'
import { catalogForSystem } from '../system-catalog'

describe('catalogForSystem', () => {
	it('maps snes to its no-intro dat', () => {
		expect(catalogForSystem('snes')).toEqual({
			source: 'no-intro',
			file: 'Nintendo - Super Nintendo Entertainment System.dat',
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
