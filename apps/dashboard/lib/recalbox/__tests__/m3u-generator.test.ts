import { describe, expect, it } from 'vitest'
import { generateM3uContent, sanitizeM3uFileName } from '../m3u-generator'
import type { MultiDiscGame } from '../multidisc-detector'

function makeGame(discs: Array<{ fileName: string; discNumber: number }>): MultiDiscGame {
	return {
		system: 'psx',
		baseName: 'Test Game (USA)',
		m3uFileName: 'Test Game (USA).m3u',
		romsDir: '/recalbox/share/roms/psx',
		discs,
		m3uAlreadyExists: false,
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
