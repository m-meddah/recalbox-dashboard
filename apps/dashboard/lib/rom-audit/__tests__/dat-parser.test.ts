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

// The arcade catalogues speak a different dialect of the same format: their rom
// entries carry NO quotes around the values. Measured on the real MAME.dat, the
// parser returned 30 038 games and 0 roms because of it.
describe('parseDat (arcade dialect)', () => {
	it('reads an unquoted rom name', () => {
		const dat = parseDat(fixture('mame-excerpt.dat'))
		const first = defined(dat.games[0])
		expect(first.name).toBe('005')
		expect(first.roms).toHaveLength(1)
		expect(defined(first.roms[0]).name).toBe('005.zip')
		expect(defined(first.roms[0]).size).toBe(29769)
	})

	it('reads the hashes of an unquoted rom entry', () => {
		const rom = defined(defined(parseDat(fixture('mame-excerpt.dat')).games[0]).roms[0])
		expect(rom.crc).toBe('d123fe67')
		expect(rom.md5).toBe('64ba2c1869a491bdae1384d3a95c2027')
		expect(rom.sha1).toBe('aeebfd4a3a6214e6efed19dd4d5716215e253b13')
	})

	// `version 2017-02-14` is not quoted either, and read as empty.
	it('reads an unquoted header version', () => {
		const dat = parseDat(fixture('mame-excerpt.dat'))
		expect(dat.name).toBe('MAME - Consolidated ROM Sets')
		expect(dat.version).toBe('2017-02-14')
	})

	it('reads the fbneo dialect too', () => {
		const dat = parseDat(fixture('fbneo-excerpt.dat'))
		expect(dat.name).toBe('FBNeo - Arcade Games')
		expect(dat.version).toBe('1.0.0.03')
		expect(defined(defined(dat.games[0]).roms[0]).name).toBe('88games.zip')
	})

	// An arcade game name routinely holds a comma, a parenthesis and an apostrophe.
	it('keeps a game name holding a comma, a parenthesis and an apostrophe', () => {
		const names = parseDat(fixture('mame-excerpt.dat')).games.map((g) => g.name)
		expect(names).toContain('10-Yard Fight (World, set 1)')
		expect(names).toContain("10-Yard Fight '85 (US, Taito license)")
	})

	it('reads every game of the excerpt, each with its rom', () => {
		const dat = parseDat(fixture('mame-excerpt.dat'))
		expect(dat.games).toHaveLength(4)
		expect(dat.games.every((g) => g.roms.length === 1)).toBe(true)
	})

	// The no-intro dialect must lose nothing: the existing suite covers it, plus
	// this explicit case for a quoted name holding spaces.
	it('still reads a quoted no-intro entry', () => {
		const dat = parseDat(
			'game (\n\tname "Zelda (Europe)"\n\trom ( name "Zelda (Europe).sfc" size 1048576 crc E95A3DD7 )\n)\n',
		)
		expect(defined(defined(dat.games[0]).roms[0]).name).toBe('Zelda (Europe).sfc')
	})

	// An unquoted value stops at the first blank, or it would swallow `size` and
	// its value into the name.
	it('does not swallow the next field into an unquoted name', () => {
		const dat = parseDat('game (\n\tname a\n\trom ( name b.zip size 42 crc AABBCCDD )\n)\n')
		const rom = defined(defined(dat.games[0]).roms[0])
		expect(rom.name).toBe('b.zip')
		expect(rom.size).toBe(42)
		expect(rom.crc).toBe('aabbccdd')
	})

	it('reads an unquoted game name', () => {
		const dat = parseDat(
			'game (\n\tname puckman\n\trom ( name puckman.zip size 1 crc AABBCCDD )\n)\n',
		)
		expect(defined(dat.games[0]).name).toBe('puckman')
	})
})
