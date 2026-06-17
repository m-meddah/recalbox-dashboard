import { describe, expect, it } from 'vitest'
import { mapExists, mapSrGame, mapSrSystems } from '../mapping'

describe('mapSrGame', () => {
	it('maps a complete API game object into an SrGame', () => {
		const raw = {
			slug: 'super-mario-world-console-super-nintendo',
			name: 'Super Mario World',
			consoleSlug: 'super-nintendo',
			score: 92,
			summary: 'A platformer.',
			specs: { players: '1-2', year: '1990', console: 'Super Nintendo' },
			characters: [],
			releaseDate: '1990-11-21',
			url: 'https://www.super-retrogamers.com/games/super-mario-world-console-super-nintendo',
		}
		expect(mapSrGame(raw)).toEqual({
			slug: 'super-mario-world-console-super-nintendo',
			name: 'Super Mario World',
			consoleSlug: 'super-nintendo',
			score: 92,
			summary: 'A platformer.',
			specs: { players: '1-2', year: '1990', console: 'Super Nintendo' },
			characters: [],
			releaseDate: '1990-11-21',
			url: 'https://www.super-retrogamers.com/games/super-mario-world-console-super-nintendo',
		})
	})

	it('accepts null score, null summary, and null releaseDate', () => {
		const game = mapSrGame({
			slug: 'a-console-nes',
			name: 'A',
			consoleSlug: 'nes',
			score: null,
			summary: null,
			specs: {},
			characters: [],
			releaseDate: null,
			url: 'https://www.super-retrogamers.com/games/a-console-nes',
		})
		expect(game?.score).toBeNull()
		expect(game?.summary).toBeNull()
		expect(game?.releaseDate).toBeNull()
	})

	it('coerces missing specs/characters/releaseDate to empty/null and always returns characters: []', () => {
		const game = mapSrGame({
			slug: 'a-console-nes',
			name: 'A',
			consoleSlug: 'nes',
			score: 1,
			summary: 'x',
			url: 'https://www.super-retrogamers.com/games/a-console-nes',
		})
		expect(game?.specs).toEqual({})
		expect(game?.characters).toEqual([])
		expect(game?.releaseDate).toBeNull()
	})

	it('returns null when required fields are missing', () => {
		expect(mapSrGame({ name: 'no slug' })).toBeNull()
		expect(mapSrGame(null)).toBeNull()
		expect(mapSrGame('nope')).toBeNull()
		expect(mapSrGame({ slug: 'x', name: 'y', consoleSlug: 'nes' })).toBeNull()
	})
})

describe('mapSrSystems', () => {
	it('maps an array of API systems', () => {
		const raw = [
			{ slug: 'super-nintendo', name: 'Super Nintendo' },
			{ slug: 'nes', name: 'NES' },
		]
		expect(mapSrSystems(raw)).toEqual([
			{ slug: 'super-nintendo', name: 'Super Nintendo' },
			{ slug: 'nes', name: 'NES' },
		])
	})

	it('drops invalid entries and returns [] for non-arrays', () => {
		expect(mapSrSystems([{ slug: 'ok', name: 'Ok' }, { slug: 'bad' }, 42])).toEqual([
			{ slug: 'ok', name: 'Ok' },
		])
		expect(mapSrSystems(null)).toEqual([])
		expect(mapSrSystems({})).toEqual([])
	})
})

describe('mapExists', () => {
	it('maps an exists response keyed by slug', () => {
		const raw = {
			'a-console-nes': {
				exists: true,
				url: 'https://www.super-retrogamers.com/games/a-console-nes',
			},
			'b-console-nes': { exists: false },
		}
		expect(mapExists(raw)).toEqual({
			'a-console-nes': {
				exists: true,
				url: 'https://www.super-retrogamers.com/games/a-console-nes',
			},
			'b-console-nes': { exists: false },
		})
	})

	it('coerces malformed entries to exists: false and ignores non-objects', () => {
		expect(mapExists({ x: { exists: 'yes' }, y: 'nope', z: { exists: true } })).toEqual({
			x: { exists: false },
			y: { exists: false },
			z: { exists: true },
		})
		expect(mapExists(null)).toEqual({})
	})
})
