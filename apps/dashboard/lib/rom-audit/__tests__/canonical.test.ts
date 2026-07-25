import { describe, expect, it } from 'vitest'
import { canonicalTitle, parseNameTags } from '../canonical'

describe('canonicalTitle', () => {
	it('strips a lone region tag', () => {
		expect(canonicalTitle('Super Mario World (USA)')).toBe('Super Mario World')
	})

	it('strips stacked region and revision tags', () => {
		expect(canonicalTitle('Super Mario World (Europe) (Rev 1)')).toBe('Super Mario World')
	})

	it('groups every disc of a multi-disc game under one title', () => {
		expect(canonicalTitle('Final Fantasy VII (USA) (Disc 1)')).toBe('Final Fantasy VII')
		expect(canonicalTitle('Final Fantasy VII (USA) (Disc 3)')).toBe('Final Fantasy VII')
	})

	it('strips language lists', () => {
		expect(canonicalTitle('Terranigma (Europe) (En,Fr,De,Es)')).toBe('Terranigma')
	})

	it('strips bracket dump markers', () => {
		expect(canonicalTitle('Chrono Trigger (USA) [b]')).toBe('Chrono Trigger')
	})

	it('strips category tags', () => {
		expect(canonicalTitle('Star Fox 2 (World) (Proto)')).toBe('Star Fox 2')
		expect(canonicalTitle('Rockman & Forte (Japan) (Unl)')).toBe('Rockman & Forte')
	})

	it('keeps a trailing group that is not a known tag', () => {
		expect(canonicalTitle('Wario Land II (USA) (Golden Edition)')).toBe(
			'Wario Land II (Golden Edition)',
		)
	})

	it('drops a known tag from the middle, regrouping variants that share an unknown suffix', () => {
		expect(canonicalTitle('Jeu (Europe) (Golden Edition)')).toBe('Jeu (Golden Edition)')
		expect(canonicalTitle('Jeu (USA) (Golden Edition)')).toBe('Jeu (Golden Edition)')
	})

	it('keeps an ampersand title untouched when it carries no tag', () => {
		expect(canonicalTitle('Sonic & Knuckles')).toBe('Sonic & Knuckles')
	})

	it('never returns an empty title', () => {
		expect(canonicalTitle('(USA)')).toBe('(USA)')
	})

	// Discovered while inspecting the real SNES No-Intro DAT (task 2, step 5):
	// re-releases stack several re-release channels in one comma list.
	it('strips a comma-separated list of category tags', () => {
		expect(
			canonicalTitle(
				'Super Mario World (USA, Europe) (Virtual Console, Classic Mini, Switch Online)',
			),
		).toBe('Super Mario World')
	})

	// NES-conversion homebrew hacks in the DAT use a dash instead of the
	// No-Intro "Rev N" space form for their revision letter.
	it('strips a dash-style revision tag from NES-conversion hacks', () => {
		expect(canonicalTitle('DuckTales (REV-B) (NES Conversion)')).toBe('DuckTales (NES Conversion)')
	})

	// PAL shows up as a standalone broadcast-standard tag on several
	// homebrew/community entries, the same way a region does.
	it('strips a PAL broadcast-standard tag', () => {
		expect(canonicalTitle('Teenage Queen (World) (v1.4) (PAL)')).toBe('Teenage Queen')
	})

	// River City Girls Zero ships Simplified/Traditional Chinese single-language
	// variants using an extended BCP-47-style code instead of a plain "Zh".
	it('strips an extended language-region code', () => {
		expect(canonicalTitle('River City Girls Zero (Zh-Hant) (Switch)')).toBe(
			'River City Girls Zero (Switch)',
		)
	})

	it('strips a debug build tag', () => {
		expect(canonicalTitle('Star Fox 2 (Debug)')).toBe('Star Fox 2')
	})
})

describe('parseNameTags', () => {
	it('extracts regions', () => {
		expect(parseNameTags('Sonic (USA, Europe)').regions).toEqual(['USA', 'Europe'])
	})

	it('extracts the revision', () => {
		expect(parseNameTags('Sonic (USA) (Rev 2)').revision).toBe('Rev 2')
	})

	it('extracts the disc number', () => {
		expect(parseNameTags('FF VII (USA) (Disc 2)').disc).toBe(2)
	})

	it('extracts categories', () => {
		expect(parseNameTags('Star Fox 2 (World) (Proto)').categories).toEqual(['proto'])
		expect(parseNameTags('Game (USA) [b]').categories).toEqual(['baddump'])
	})

	it('returns empty collections when there is no tag', () => {
		const tags = parseNameTags('Sonic & Knuckles')
		expect(tags.regions).toEqual([])
		expect(tags.categories).toEqual([])
		expect(tags.revision).toBeUndefined()
	})

	it('extracts a comma-separated list of categories, in order', () => {
		expect(
			parseNameTags('Super Mario World (Virtual Console, Classic Mini, Switch Online)').categories,
		).toEqual(['virtual-console', 'classic-mini', 'switch-online'])
	})
})
