import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGamelist, parseRecalboxDate } from '../gamelist-parser'

const FIXTURES = join(__dirname, '__fixtures__')
const ROMS_BASE = '/recalbox/share/externals/usb0/recalbox/roms/snes'

function fixture(name: string) {
	return readFileSync(join(FIXTURES, name), 'utf-8')
}

describe('parseRecalboxDate', () => {
	it('parses a valid Recalbox date', () => {
		const d = parseRecalboxDate('19960322T000000')
		expect(d).toBeInstanceOf(Date)
		expect(d?.getUTCFullYear()).toBe(1996)
		expect(d?.getUTCMonth()).toBe(2) // March = 2
		expect(d?.getUTCDate()).toBe(22)
	})

	it('parses a date with time component', () => {
		const d = parseRecalboxDate('20260315T204512')
		expect(d?.getUTCHours()).toBe(20)
		expect(d?.getUTCMinutes()).toBe(45)
		expect(d?.getUTCSeconds()).toBe(12)
	})

	it('returns undefined for empty string', () => {
		expect(parseRecalboxDate('')).toBeUndefined()
	})

	it('returns undefined for null', () => {
		expect(parseRecalboxDate(null)).toBeUndefined()
	})

	it('returns undefined for malformed date', () => {
		expect(parseRecalboxDate('not-a-date')).toBeUndefined()
	})
})

describe('parseGamelist — snes fixture', () => {
	const games = parseGamelist(fixture('snes.gamelist.xml'), ROMS_BASE)

	it('returns 3 games (ignores <folder> elements)', () => {
		expect(games).toHaveLength(3)
	})

	it('builds absolute romPath correctly (subfolder)', () => {
		expect(games[0]!.romPath).toBe(
			`${ROMS_BASE}/0-9/'96 Zenkoku Koukou Soccer Senshuken (Japan).7z`,
		)
	})

	it('builds absolute imagePath', () => {
		expect(games[0]!.imagePath).toBe(
			`${ROMS_BASE}/media/images/96 Zenkoku Koukou Soccer Senshuken.png`,
		)
	})

	it('builds absolute videoPath', () => {
		expect(games[0]!.videoPath).toBe(
			`${ROMS_BASE}/media/videos/96 Zenkoku Koukou Soccer Senshuken.mp4`,
		)
	})

	it('parses rating as number', () => {
		expect(games[0]!.rating).toBe(0.75)
	})

	it('parses releaseDate', () => {
		expect(games[0]!.releaseDate?.getUTCFullYear()).toBe(1996)
	})

	it('parses hash and region', () => {
		expect(games[0]!.hash).toBe('71120F9B')
		expect(games[0]!.region).toBe('jp')
	})

	it('favorite defaults to false', () => {
		expect(games[0]!.favorite).toBe(false)
	})

	it('parses favorite=true', () => {
		expect(games[1]!.favorite).toBe(true)
	})

	it('parses playCount', () => {
		expect(games[1]!.playCount).toBe(5)
	})

	it('parses lastPlayed', () => {
		expect(games[1]!.lastPlayed?.getUTCFullYear()).toBe(2026)
	})

	it('parses hidden=true', () => {
		expect(games[2]!.hidden).toBe(true)
	})
})

describe('parseGamelist — minimal fixture', () => {
	const games = parseGamelist(fixture('minimal.gamelist.xml'), ROMS_BASE)

	it('parses one game', () => {
		expect(games).toHaveLength(1)
	})

	it('strips ./ prefix from path', () => {
		expect(games[0]!.romPath).toBe(`${ROMS_BASE}/Super Mario World (Europe).sfc`)
	})

	it('optional fields are undefined', () => {
		expect(games[0]!.imagePath).toBeUndefined()
		expect(games[0]!.rating).toBeUndefined()
		expect(games[0]!.releaseDate).toBeUndefined()
	})

	it('favorite and hidden default to false', () => {
		expect(games[0]!.favorite).toBe(false)
		expect(games[0]!.hidden).toBe(false)
	})
})

describe('parseGamelist — empty gamelist', () => {
	it('returns empty array', () => {
		expect(parseGamelist(fixture('empty.gamelist.xml'), ROMS_BASE)).toEqual([])
	})
})

describe('parseGamelist — malformed XML', () => {
	it('returns empty array without throwing', () => {
		expect(parseGamelist(fixture('malformed.gamelist.xml'), ROMS_BASE)).toEqual([])
	})
})

describe('parseGamelist — partial gamelist (missing required fields)', () => {
	const games = parseGamelist(fixture('partial.gamelist.xml'), ROMS_BASE)

	it('skips game with missing <path>', () => {
		expect(games.find((g) => g.name === 'Missing Path Game')).toBeUndefined()
	})

	it('skips game with missing <name>', () => {
		expect(games.find((g) => g.romPath.includes('missing_name_game'))).toBeUndefined()
	})

	it('keeps valid games', () => {
		expect(games).toHaveLength(2)
		expect(games[0]!.name).toBe('Valid Game')
		expect(games[1]!.name).toBe('Another Valid Game')
	})

	it('parses all boolean and numeric fields on second valid game', () => {
		const g = games[1]!
		expect(g.favorite).toBe(true)
		expect(g.hidden).toBe(false)
		expect(g.playCount).toBe(3)
		expect(g.lastPlayed?.getUTCFullYear()).toBe(2025)
	})
})
