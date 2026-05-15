import { describe, expect, it } from 'vitest'
import { parseUserdataIni } from '../userdata-parser'

describe('parseUserdataIni', () => {
	it('parses a favorite entry without ./ prefix', () => {
		const map = parseUserdataIni('rom.sfc:favorite=true')
		expect(map.get('rom.sfc')?.favorite).toBe(true)
	})

	it('strips ./ prefix so keys match relativeRomPath from parseGamelist', () => {
		const map = parseUserdataIni('./rom.sfc:favorite=true')
		expect(map.get('rom.sfc')?.favorite).toBe(true)
		expect(map.has('./rom.sfc')).toBe(false)
	})

	it('parses all known keys', () => {
		const map = parseUserdataIni(
			'./game.zip:favorite=true,hidden=false,playcount=3,lastplayed=20260315T204512',
		)
		const entry = map.get('game.zip')
		expect(entry?.favorite).toBe(true)
		expect(entry?.hidden).toBe(false)
		expect(entry?.playCount).toBe(3)
		expect(entry?.lastPlayed?.getUTCFullYear()).toBe(2026)
	})

	it('handles paths in subdirectories', () => {
		const map = parseUserdataIni('./0-9/Super Mario World (USA).sfc:favorite=true')
		expect(map.get('0-9/Super Mario World (USA).sfc')?.favorite).toBe(true)
	})

	it('skips blank lines and malformed entries', () => {
		const map = parseUserdataIni('\n\nno-colon-line\n./rom.sfc:favorite=true\n')
		expect(map.size).toBe(1)
	})

	it('returns false for favorite=false', () => {
		const map = parseUserdataIni('./rom.sfc:favorite=false')
		expect(map.get('rom.sfc')?.favorite).toBe(false)
	})
})
