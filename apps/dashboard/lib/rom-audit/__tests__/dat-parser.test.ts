import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDat } from '../dat-parser'

const FIXTURES = join(__dirname, '__fixtures__')

function fixture(name: string) {
	return readFileSync(join(FIXTURES, name), 'utf-8')
}

describe('parseDat', () => {
	it('reads the header name and version', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		expect(dat.name).toBe('Nintendo - Super Nintendo Entertainment System')
		expect(dat.version).toBe('2026.05.02')
	})

	it('parses every game block', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		expect(dat.games).toHaveLength(4)
		expect(dat.games[0].name).toBe('Dragon Ball Z - La Legende Saien (France)')
		expect(dat.games[0].region).toBe('France')
	})

	it('parses rom size and lowercases every hash', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		const rom = dat.games[0].roms[0]
		expect(rom.name).toBe('Dragon Ball Z - La Legende Saien (France).sfc')
		expect(rom.size).toBe(2097152)
		expect(rom.crc).toBe('8f24f886')
		expect(rom.md5).toBe('36e1391f0b1f29f16ef5d4eb83c3725b')
		expect(rom.sha1).toBe('827c071f8aebe93f80576800266f74f82ff9e41b')
	})

	it('keeps parentheses that belong to the game name', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		expect(dat.games[2].name).toBe('Super Mario World (Europe) (Rev 1)')
		expect(dat.games[2].roms[0].name).toBe('Super Mario World (Europe) (Rev 1).sfc')
	})

	it('parses the serial field on both game and rom', () => {
		const dat = parseDat(fixture('redump-gamecube.dat'))
		expect(dat.games[0].serial).toBe('DL-DOL-GW7P-EUR')
		expect(dat.games[0].roms[0].serial).toBe('DL-DOL-GW7P-EUR')
	})

	it('returns an empty game list for an empty input', () => {
		expect(parseDat('').games).toEqual([])
	})

	it('does not let a truncated rom line corrupt the game name', () => {
		const text = [
			'game (',
			'\tname "Foo (USA)"',
			'\trom ( name "Foo (USA).sfc" size 100 crc ABCD1234',
			')',
		].join('\n')
		const dat = parseDat(text)
		expect(dat.games[0].name).toBe('Foo (USA)')
	})

	it('does not throw when a game block is never closed', () => {
		const text = ['game (', '\tname "Foo (USA)"'].join('\n')
		expect(() => parseDat(text)).not.toThrow()
	})

	it('does not throw and skips a rom entry without a name field', () => {
		const text = ['game (', '\tname "Foo (USA)"', '\trom ( size 100 crc ABCD1234 )', ')'].join('\n')
		const dat = parseDat(text)
		expect(() => parseDat(text)).not.toThrow()
		expect(dat.games[0].roms).toEqual([])
	})
})
