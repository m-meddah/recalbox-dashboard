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

	// Mixed region/broadcast-standard forms are otherwise only exercised
	// through parseNameTags; canonicalTitle shares the same decomposition,
	// but that sharing was never pinned down at this level directly.
	it('strips a mixed region/broadcast-standard group given as one comma list', () => {
		expect(canonicalTitle('Sonic (Europe, PAL)')).toBe('Sonic')
	})

	it('strips a mixed region/broadcast-standard group given as two separate groups', () => {
		expect(canonicalTitle('Sonic (Europe) (PAL)')).toBe('Sonic')
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

	// The 5 tags added to the vocabulary at step 5, each checked at the
	// parseNameTags level (not just indirectly through canonicalTitle): a
	// regression in one field's assignment branch would not show up in the
	// other's tests, since each output field has its own logic.
	it('extracts a dash-style revision tag', () => {
		expect(parseNameTags('DuckTales (REV-B) (NES Conversion)').revision).toBe('REV-B')
	})

	it('extracts an extended language-region code', () => {
		expect(parseNameTags('River City Girls Zero (Zh-Hant) (Switch)').languages).toEqual(['Zh-Hant'])
	})

	it('extracts a debug build tag as a category', () => {
		expect(parseNameTags('Star Fox 2 (Debug)').categories).toEqual(['debug'])
	})

	it('extracts PAL as a broadcast standard, not a region', () => {
		const tags = parseNameTags('Teenage Queen (World) (v1.4) (PAL)')
		expect(tags.broadcastStandards).toEqual(['PAL'])
		expect(tags.regions).not.toContain('PAL')
	})

	it('splits a mixed region/broadcast-standard group without misfiling the region', () => {
		const tags = parseNameTags('Sonic (Europe, PAL)')
		expect(tags.regions).toEqual(['Europe'])
		expect(tags.broadcastStandards).toEqual(['PAL'])
	})

	it('accumulates PAL from a separate group alongside a region group', () => {
		const tags = parseNameTags('Sonic (Europe) (PAL)')
		expect(tags.regions).toEqual(['Europe'])
		expect(tags.broadcastStandards).toEqual(['PAL'])
	})

	// A region-bearing group assigns instead of accumulating in the current
	// implementation, unlike categories and broadcastStandards — two separate
	// region groups would silently lose the first one. Improbable on the
	// current No-Intro DAT (regions are grouped in a single list), but
	// regions is exactly what task 4 filters missing games by, so a silent
	// loss here is the one thing to avoid.
	it('accumulates regions from multiple separate region groups', () => {
		const tags = parseNameTags('Sonic (USA) (Europe)')
		expect(tags.regions).toEqual(['USA', 'Europe'])
	})

	// languages assigned where regions, categories and broadcastStandards all
	// accumulate: a second language group silently discarded the first.
	it('accumulates languages from multiple separate language groups', () => {
		const tags = parseNameTags('Sonic (En,Fr) (De)')
		expect(tags.languages).toEqual(['En', 'Fr', 'De'])
	})
})
