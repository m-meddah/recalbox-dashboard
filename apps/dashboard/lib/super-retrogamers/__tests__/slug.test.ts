import { describe, expect, it } from 'vitest'
import { SR_SYSTEM_SLUGS, gameToSlug, gameToSlugVariants, slugToParts } from '../slug'

describe('SR_SYSTEM_SLUGS', () => {
	it('maps snes to super-nintendo', () => {
		expect(SR_SYSTEM_SLUGS.snes).toBe('super-nintendo')
	})
	it('maps psx to playstation', () => {
		expect(SR_SYSTEM_SLUGS.psx).toBe('playstation')
	})
	it('maps gb to game-boy', () => {
		expect(SR_SYSTEM_SLUGS.gb).toBe('game-boy')
	})
})

describe('gameToSlug', () => {
	it('basic game name + system', () => {
		expect(gameToSlug('Super Mario World (USA).smc', 'snes')).toBe(
			'super-mario-world-console-super-nintendo',
		)
	})
	it('strips region tags', () => {
		expect(gameToSlug('Mega Man 7 (USA).smc', 'snes')).toBe(
			'mega-man-7-console-super-nintendo',
		)
	})
	it('strips [!] quality tag', () => {
		expect(gameToSlug('Castlevania - Symphony of the Night (USA) [!].bin', 'psx')).toBe(
			'castlevania-symphony-of-the-night-console-playstation',
		)
	})
	it('strips version tags', () => {
		expect(gameToSlug('Some Game (v1.0) (USA).nes', 'nes')).toBe(
			'some-game-console-nes',
		)
	})
	it('strips Rev tags', () => {
		expect(gameToSlug('Sonic the Hedgehog (Rev A) (USA).md', 'megadrive')).toBe(
			'sonic-the-hedgehog-console-megadrive',
		)
	})
	it('normalises accents', () => {
		expect(gameToSlug('Alerte à Malibu (France).nes', 'nes')).toBe(
			'alerte-a-malibu-console-nes',
		)
	})
	it('handles apostrophes', () => {
		expect(gameToSlug("Yoshi's Island - Super Mario World 2 (USA).smc", 'snes')).toBe(
			'yoshis-island-super-mario-world-2-console-super-nintendo',
		)
	})
	it('collapses multiple dashes from hyphens in title', () => {
		expect(gameToSlug('Street Fighter II - The World Warrior (USA).smc', 'snes')).toBe(
			'street-fighter-ii-the-world-warrior-console-super-nintendo',
		)
	})
	it('returns null for unmapped system', () => {
		expect(gameToSlug('Pac-Man.zip', 'mame')).toBeNull()
	})
	it('returns null for fbneo', () => {
		expect(gameToSlug('1942.zip', 'fbneo')).toBeNull()
	})
	it('handles number-only prefix', () => {
		expect(gameToSlug('007 Agent Under Fire (USA).iso', 'ps2')).toBe(
			'007-agent-under-fire-console-playstation-2',
		)
	})
	it('handles colons', () => {
		expect(gameToSlug('Metroid Prime: Hunters (USA).nds', 'nds')).toBe(
			'metroid-prime-hunters-console-nintendo-ds',
		)
	})
	it('handles .cue extension', () => {
		expect(gameToSlug('Final Fantasy VII (USA).cue', 'psx')).toBe(
			'final-fantasy-vii-console-playstation',
		)
	})
	it('handles gba system', () => {
		expect(gameToSlug('Pokemon Fire Red (USA).gba', 'gba')).toBe(
			'pokemon-fire-red-console-game-boy-advance',
		)
	})
	it('handles n64 system', () => {
		expect(gameToSlug('The Legend of Zelda - Ocarina of Time (USA).z64', 'n64')).toBe(
			'the-legend-of-zelda-ocarina-of-time-console-nintendo-64',
		)
	})
})

describe('gameToSlugVariants', () => {
	it('returns single variant when name does not start with the-', () => {
		const variants = gameToSlugVariants('Super Mario World (USA).smc', 'snes')
		expect(variants).toEqual(['super-mario-world-console-super-nintendo'])
	})
	it('returns two variants when name starts with the-', () => {
		const variants = gameToSlugVariants(
			'The Legend of Zelda - A Link to the Past (USA).smc',
			'snes',
		)
		expect(variants).toHaveLength(2)
		expect(variants[0]).toBe('the-legend-of-zelda-a-link-to-the-past-console-super-nintendo')
		expect(variants[1]).toBe('legend-of-zelda-a-link-to-the-past-the-console-super-nintendo')
	})
	it('returns empty array for unmapped system', () => {
		expect(gameToSlugVariants('Game.zip', 'mame')).toEqual([])
	})
})

describe('slugToParts', () => {
	it('extracts name and system from slug', () => {
		const result = slugToParts('super-mario-world-console-super-nintendo')
		expect(result).toEqual({ name: 'super-mario-world', system: 'snes' })
	})
	it('returns null for unrecognised console slug', () => {
		expect(slugToParts('some-game-console-unknown-system')).toBeNull()
	})
	it('returns null for malformed slug', () => {
		expect(slugToParts('no-console-here')).toBeNull()
	})
})
