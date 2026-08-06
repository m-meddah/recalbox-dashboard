import { describe, expect, it } from 'vitest'
import {
	generateM3uContent,
	m3uNeedsRepair,
	normalizeM3uContent,
	sanitizeM3uFileName,
} from '../m3u-generator'
import type { MultiDiscGame } from '../multidisc-detector'

function makeGame(discs: Array<{ fileName: string; discNumber: number }>): MultiDiscGame {
	return {
		system: 'psx',
		baseName: 'Test Game (USA)',
		m3uFileName: 'Test Game (USA).m3u',
		romsDir: '/recalbox/share/roms/psx',
		discs,
		m3uAlreadyExists: false,
		m3uNeedsRepair: false,
		hasGap: false,
	}
}

describe('generateM3uContent', () => {
	it('joins disc filenames with LF', () => {
		const game = makeGame([
			{ fileName: 'Final Fantasy VII (USA) (Disc 1).chd', discNumber: 1 },
			{ fileName: 'Final Fantasy VII (USA) (Disc 2).chd', discNumber: 2 },
			{ fileName: 'Final Fantasy VII (USA) (Disc 3).chd', discNumber: 3 },
		])
		const content = generateM3uContent(game)
		expect(content).toBe(
			'Final Fantasy VII (USA) (Disc 1).chd\nFinal Fantasy VII (USA) (Disc 2).chd\nFinal Fantasy VII (USA) (Disc 3).chd\n',
		)
	})

	it('ends with a trailing LF', () => {
		const game = makeGame([
			{ fileName: 'Game (Disc 1).chd', discNumber: 1 },
			{ fileName: 'Game (Disc 2).chd', discNumber: 2 },
		])
		expect(generateM3uContent(game).endsWith('\n')).toBe(true)
	})

	it('contains NO carriage returns (no CRLF)', () => {
		const game = makeGame([
			{ fileName: 'Game (Disc 1).chd', discNumber: 1 },
			{ fileName: 'Game (Disc 2).chd', discNumber: 2 },
		])
		expect(generateM3uContent(game)).not.toContain('\r')
	})

	it('works with two discs', () => {
		const game = makeGame([
			{ fileName: 'Metal Gear Solid (USA) (Disc 1).chd', discNumber: 1 },
			{ fileName: 'Metal Gear Solid (USA) (Disc 2).chd', discNumber: 2 },
		])
		const lines = generateM3uContent(game).split('\n').filter(Boolean)
		expect(lines).toHaveLength(2)
	})
})

describe('sanitizeM3uFileName', () => {
	it('appends .m3u extension', () => {
		expect(sanitizeM3uFileName('Final Fantasy VII (USA)')).toBe('Final Fantasy VII (USA).m3u')
	})

	it('replaces characters invalid in filenames with underscore', () => {
		expect(sanitizeM3uFileName('Game: Subtitle (USA)')).toBe('Game_ Subtitle (USA).m3u')
		expect(sanitizeM3uFileName('Game/Sub (USA)')).toBe('Game_Sub (USA).m3u')
		expect(sanitizeM3uFileName('Game*Sub (USA)')).toBe('Game_Sub (USA).m3u')
	})

	it('collapses multiple spaces', () => {
		expect(sanitizeM3uFileName('Game  Title (USA)')).toBe('Game Title (USA).m3u')
	})

	it('leaves normal names unchanged', () => {
		expect(sanitizeM3uFileName("3x3 Eyes - Tenrin'ou Genmu (Japan)")).toBe(
			"3x3 Eyes - Tenrin'ou Genmu (Japan).m3u",
		)
	})
})

describe('normalizeM3uContent', () => {
	it('converts CRLF to LF', () => {
		expect(normalizeM3uContent('a.rvz\r\nb.rvz\r\n')).toBe('a.rvz\nb.rvz\n')
	})

	it('converts lone CR to LF', () => {
		expect(normalizeM3uContent('a.rvz\rb.rvz\r')).toBe('a.rvz\nb.rvz\n')
	})

	it('strips a UTF-8 \uFEFF', () => {
		expect(normalizeM3uContent('\uFEFFa.rvz\r\nb.rvz\r\n')).toBe('a.rvz\nb.rvz\n')
	})

	it('drops blank lines and trailing whitespace', () => {
		expect(normalizeM3uContent('a.rvz  \n\n\nb.rvz\t\n\n')).toBe('a.rvz\nb.rvz\n')
	})

	it('adds a missing trailing LF', () => {
		expect(normalizeM3uContent('a.rvz\nb.rvz')).toBe('a.rvz\nb.rvz\n')
	})

	it('preserves hand-added lines the detector would not produce', () => {
		const raw = 'Game (Disc 1).rvz\r\nGame (Disc 2).rvz\r\nGame (Bonus Disc).rvz\r\n'
		expect(normalizeM3uContent(raw)).toBe(
			'Game (Disc 1).rvz\nGame (Disc 2).rvz\nGame (Bonus Disc).rvz\n',
		)
	})

	it('is idempotent on already-clean content', () => {
		const clean = 'a.rvz\nb.rvz\n'
		expect(normalizeM3uContent(clean)).toBe(clean)
	})

	it('returns empty string for an empty file', () => {
		expect(normalizeM3uContent('')).toBe('')
		expect(normalizeM3uContent('\r\n\r\n')).toBe('')
	})
})

describe('m3uNeedsRepair', () => {
	it('flags CRLF', () => {
		expect(m3uNeedsRepair('a.rvz\r\nb.rvz\r\n')).toBe(true)
	})

	it('flags a \uFEFF even when line endings are already LF', () => {
		expect(m3uNeedsRepair('\uFEFFa.rvz\nb.rvz\n')).toBe(true)
	})

	it('flags a missing trailing LF', () => {
		expect(m3uNeedsRepair('a.rvz\nb.rvz')).toBe(true)
	})

	it('flags trailing whitespace', () => {
		expect(m3uNeedsRepair('a.rvz \nb.rvz\n')).toBe(true)
	})

	it('accepts a clean file', () => {
		expect(m3uNeedsRepair('a.rvz\nb.rvz\n')).toBe(false)
	})

	it('accepts what generateM3uContent produces', () => {
		const content = generateM3uContent(
			makeGame([
				{ fileName: 'Game (Disc 1).rvz', discNumber: 1 },
				{ fileName: 'Game (Disc 2).rvz', discNumber: 2 },
			]),
		)
		expect(m3uNeedsRepair(content)).toBe(false)
	})
})
