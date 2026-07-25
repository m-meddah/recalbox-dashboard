import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDat } from '../dat-parser'
import { defined } from './test-helpers'

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
		const game = defined(dat.games[0])
		expect(game.name).toBe('Dragon Ball Z - La Legende Saien (France)')
		expect(game.region).toBe('France')
	})

	it('parses rom size and lowercases every hash', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		const rom = defined(defined(dat.games[0]).roms[0])
		expect(rom.name).toBe('Dragon Ball Z - La Legende Saien (France).sfc')
		expect(rom.size).toBe(2097152)
		expect(rom.crc).toBe('8f24f886')
		expect(rom.md5).toBe('36e1391f0b1f29f16ef5d4eb83c3725b')
		expect(rom.sha1).toBe('827c071f8aebe93f80576800266f74f82ff9e41b')
	})

	it('keeps parentheses that belong to the game name', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		const game = defined(dat.games[2])
		expect(game.name).toBe('Super Mario World (Europe) (Rev 1)')
		expect(defined(game.roms[0]).name).toBe('Super Mario World (Europe) (Rev 1).sfc')
	})

	it('parses the serial field on both game and rom', () => {
		const dat = parseDat(fixture('redump-gamecube.dat'))
		const game = defined(dat.games[0])
		expect(game.serial).toBe('DL-DOL-GW7P-EUR')
		expect(defined(game.roms[0]).serial).toBe('DL-DOL-GW7P-EUR')
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
		expect(defined(dat.games[0]).name).toBe('Foo (USA)')
	})

	it('does not throw when a game block is never closed', () => {
		const text = ['game (', '\tname "Foo (USA)"'].join('\n')
		expect(() => parseDat(text)).not.toThrow()
	})

	// clrmamepro also defines disk/sample/archive blocks, which MAME dats use.
	// Their fields were recognised by substring anywhere in the line, so a disk
	// entry silently overwrote the game name it belonged to.
	it('does not let a disk entry overwrite the game name', () => {
		const text = [
			'game (',
			'\tname "Foo (USA)"',
			'\tdisk ( name "foo-disk1.chd" sha1 ABCD1234 )',
			')',
		].join('\n')
		const game = defined(parseDat(text).games[0])
		expect(game.name).toBe('Foo (USA)')
		expect(game.roms).toEqual([])
	})

	it('does not let a sample or archive entry overwrite the game name', () => {
		const text = [
			'game (',
			'\tname "Foo (USA)"',
			'\tsample ( name "foo-sample" )',
			'\tarchive ( name "foo-archive" )',
			')',
		].join('\n')
		expect(defined(parseDat(text).games[0]).name).toBe('Foo (USA)')
	})

	it('does not let a disk entry overwrite the game region or serial', () => {
		const text = [
			'game (',
			'\tname "Foo (USA)"',
			'\tregion "USA"',
			'\tserial "DL-DOL-GW7E-USA"',
			'\tdisk ( name "foo.chd" region "Europe" serial "DL-DOL-XXXX-EUR" )',
			')',
		].join('\n')
		const game = defined(parseDat(text).games[0])
		expect(game.region).toBe('USA')
		expect(game.serial).toBe('DL-DOL-GW7E-USA')
	})

	it('does not throw and skips a rom entry without a name field', () => {
		const text = ['game (', '\tname "Foo (USA)"', '\trom ( size 100 crc ABCD1234 )', ')'].join('\n')
		const dat = parseDat(text)
		expect(() => parseDat(text)).not.toThrow()
		expect(defined(dat.games[0]).roms).toEqual([])
	})
})
