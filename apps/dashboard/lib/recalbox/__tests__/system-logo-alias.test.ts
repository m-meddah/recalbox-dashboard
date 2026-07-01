import { describe, expect, it } from 'vitest'
import { logoNameForSystem } from '../system-logo-alias'

describe('logoNameForSystem', () => {
	it('aliases ES ids whose theme logo filename differs', () => {
		expect(logoNameForSystem('wswan')).toBe('wonderswan')
		expect(logoNameForSystem('wswanc')).toBe('wonderswancolor')
		expect(logoNameForSystem('o2em')).toBe('odyssey2')
		expect(logoNameForSystem('oricatmos')).toBe('oric')
		expect(logoNameForSystem('dos')).toBe('pc')
		expect(logoNameForSystem('thomson')).toBe('to8')
	})

	it('is identity for systems whose id matches the logo file', () => {
		expect(logoNameForSystem('snes')).toBe('snes')
		expect(logoNameForSystem('gamecube')).toBe('gamecube') // theme ships gamecube.png, not gc.png
		expect(logoNameForSystem('nes')).toBe('nes')
	})
})
