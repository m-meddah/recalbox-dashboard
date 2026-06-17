import { describe, expect, it } from 'vitest'
import { mapRomRegionToSr, resolveRegion } from '../region'

describe('mapRomRegionToSr', () => {
	it('maps the six exact ScreenScraper codes (case-insensitive)', () => {
		expect(mapRomRegionToSr('fr')).toBe('FR')
		expect(mapRomRegionToSr('EU')).toBe('EU')
		expect(mapRomRegionToSr('us')).toBe('US')
		expect(mapRomRegionToSr('jp')).toBe('JP')
		expect(mapRomRegionToSr('wor')).toBe('WOR')
		expect(mapRomRegionToSr('asi')).toBe('ASI')
	})

	it('maps common full-word aliases', () => {
		expect(mapRomRegionToSr('world')).toBe('WOR')
		expect(mapRomRegionToSr('usa')).toBe('US')
		expect(mapRomRegionToSr('japan')).toBe('JP')
		expect(mapRomRegionToSr('europe')).toBe('EU')
		expect(mapRomRegionToSr('france')).toBe('FR')
		expect(mapRomRegionToSr('asia')).toBe('ASI')
	})

	it('returns the first mapped token for comma-separated regions', () => {
		expect(mapRomRegionToSr('us,eu')).toBe('US')
		expect(mapRomRegionToSr('de,eu')).toBe('EU')
		expect(mapRomRegionToSr(' jp , us ')).toBe('JP')
	})

	it('returns null for unmapped, empty, or missing input', () => {
		expect(mapRomRegionToSr('de')).toBeNull()
		expect(mapRomRegionToSr('es,it')).toBeNull()
		expect(mapRomRegionToSr('')).toBeNull()
		expect(mapRomRegionToSr(null)).toBeNull()
		expect(mapRomRegionToSr(undefined)).toBeNull()
	})
})

describe('resolveRegion', () => {
	it('prefers the mapped ROM region', () => {
		expect(resolveRegion('us,eu', 'JP')).toBe('US')
		expect(resolveRegion('wor', '')).toBe('WOR')
	})

	it('falls back to preferredRegion when the ROM region does not map', () => {
		expect(resolveRegion('de', 'EU')).toBe('EU')
		expect(resolveRegion(null, 'FR')).toBe('FR')
	})

	it('falls back to empty (API default) when nothing resolves', () => {
		expect(resolveRegion('de', '')).toBe('')
		expect(resolveRegion(undefined, '')).toBe('')
	})
})
