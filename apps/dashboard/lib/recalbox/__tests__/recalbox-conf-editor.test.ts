import { describe, expect, it } from 'vitest'
import { extractConfKeysBySuffix, parseConfValues, setConfValues } from '../recalbox-conf-editor'

const CONF = `## Recalbox config
global.emulator=libretro
# snes.emulator=commented
snes.ratio=auto
audio.volume=90
`

describe('parseConfValues', () => {
	it('reads uncommented keys, null for absent/commented', () => {
		expect(parseConfValues(CONF, ['snes.ratio', 'snes.emulator', 'missing.key'])).toEqual({
			'snes.ratio': 'auto',
			'snes.emulator': null, // only a commented occurrence exists
			'missing.key': null,
		})
	})
})

describe('extractConfKeysBySuffix', () => {
	it('collects every uncommented key with the suffix', () => {
		expect(extractConfKeysBySuffix(CONF, '.emulator')).toEqual({ 'global.emulator': 'libretro' })
	})
})

describe('setConfValues', () => {
	it('replaces an existing key in place', () => {
		const out = setConfValues(CONF, { 'audio.volume': '100' })
		expect(out).toContain('audio.volume=100')
		expect(out).not.toContain('audio.volume=90')
		// other lines untouched
		expect(out).toContain('global.emulator=libretro')
		expect(out).toContain('# snes.emulator=commented')
	})

	it('appends a new key that did not exist', () => {
		const out = setConfValues(CONF, { 'snes.emulator': 'libretro', 'snes.core': 'snes9x' })
		expect(out).toContain('snes.emulator=libretro')
		expect(out).toContain('snes.core=snes9x')
		// did not touch the commented line
		expect(out).toContain('# snes.emulator=commented')
	})

	it('removes a key when value is null (reset)', () => {
		const out = setConfValues(CONF, { 'snes.ratio': null })
		expect(out).not.toMatch(/^snes\.ratio=/m)
		expect(out).toContain('audio.volume=90')
	})

	it('keeps a single trailing newline', () => {
		const out = setConfValues(CONF, { 'snes.emulator': 'libretro' })
		expect(out.endsWith('\n')).toBe(true)
		expect(out.endsWith('\n\n')).toBe(false)
	})

	it('preserves CRLF line endings when present', () => {
		const crlf = 'a=1\r\nb=2\r\n'
		expect(setConfValues(crlf, { a: '9' })).toBe('a=9\r\nb=2\r\n')
	})
})
