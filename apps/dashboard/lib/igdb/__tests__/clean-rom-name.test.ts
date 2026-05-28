import { describe, expect, it } from 'vitest'
import { cleanRomName, generateNameVariants } from '../clean-rom-name'

describe('cleanRomName', () => {
	it('removes USA region', () => {
		expect(cleanRomName('Super Mario World (USA)')).toBe('Super Mario World')
	})
	it('removes multiple regions', () => {
		expect(cleanRomName('Castlevania (USA, Europe)')).toBe('Castlevania')
	})
	it('removes revision tags', () => {
		expect(cleanRomName('Street Fighter II (USA) (Rev A)')).toBe('Street Fighter II')
	})
	it('removes square bracket tags', () => {
		expect(cleanRomName('Pokemon Red (UE) [S][!]')).toBe('Pokemon Red')
	})
	it('collapses dash separators', () => {
		expect(cleanRomName('Castlevania - Bloodlines (USA)')).toBe('Castlevania Bloodlines')
	})
	it('removes GameCube/Wii extensions', () => {
		expect(cleanRomName('Metroid Prime (USA).rvz')).toBe('Metroid Prime')
		expect(cleanRomName('Mario Kart Wii (USA).wbfs')).toBe('Mario Kart Wii')
		expect(cleanRomName('Zelda Wind Waker [GZLE01].iso')).toBe('Zelda Wind Waker')
	})
	it('removes common ROM extensions', () => {
		expect(cleanRomName('Super Mario Bros.nes')).toBe('Super Mario Bros')
		expect(cleanRomName('Chrono Trigger.sfc')).toBe('Chrono Trigger')
	})
	it('removes beta/proto tags', () => {
		expect(cleanRomName('Some Game (Beta 2)')).toBe('Some Game')
	})
	it('removes version tags', () => {
		expect(cleanRomName('Game Title (v1.2)')).toBe('Game Title')
	})
})

describe('generateNameVariants', () => {
	it('includes the cleaned name', () => {
		const variants = generateNameVariants('Final Fantasy VII (USA)')
		expect(variants[0]).toBe('Final Fantasy VII')
	})
	it('converts roman numerals to arabic', () => {
		const variants = generateNameVariants('Final Fantasy VII (USA)')
		expect(variants).toContain('Final Fantasy 7')
	})
	it('converts arabic to roman numerals', () => {
		const variants = generateNameVariants('Street Fighter 2 (USA)')
		expect(variants).toContain('Street Fighter II')
	})
	it('includes subtitle-less variant when colon present', () => {
		const variants = generateNameVariants('Legend of Zelda: Ocarina of Time')
		expect(variants).toContain('Legend of Zelda')
	})
	it('filters out variants shorter than 2 chars', () => {
		const variants = generateNameVariants('A (USA)')
		expect(variants.every((v) => v.length >= 2)).toBe(true)
	})
})
