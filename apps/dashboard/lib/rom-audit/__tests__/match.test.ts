import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDat } from '../dat-parser'
import type { ManifestEntry } from '../manifest'
import { auditSystem, filterMissingGames } from '../match'
import { defined } from './test-helpers'

const FIXTURES = join(__dirname, '__fixtures__')
const snes = parseDat(readFileSync(join(FIXTURES, 'no-intro-snes.dat'), 'utf-8'))
const gamecube = parseDat(readFileSync(join(FIXTURES, 'redump-gamecube.dat'), 'utf-8'))
// A re-release shipping the exact same disc image as the original: two dat
// entries, two canonical titles, one hash. 24 % of the real Redump PSX dat is
// in this situation.
const sharedHash = parseDat(readFileSync(join(FIXTURES, 'redump-shared-hash.dat'), 'utf-8'))
// "Star Fox 2" carries both a proto entry and a commercial one; "Bio Force Ape"
// is proto and nothing else. A category filter has to tell the two apart.
const protoVariants = parseDat(
	readFileSync(join(FIXTURES, 'no-intro-proto-variants.dat'), 'utf-8'),
)

function entry(over: Partial<ManifestEntry>): ManifestEntry {
	return {
		path: '/recalbox/share/roms/snes/game.zip',
		size: 524288,
		mtime: 1,
		system: 'snes',
		mount: '/recalbox/share',
		kind: 'zip-entry',
		...over,
	}
}

describe('auditSystem', () => {
	it('matches by crc32 and reports verified', () => {
		const res = auditSystem('snes', [entry({ crc32: '8f24f886' })], snes)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('verified')
		expect(file.datEntryName).toBe('Dragon Ball Z - La Legende Saien (France)')
	})

	it('matches by sha1 when crc32 is absent', () => {
		const res = auditSystem(
			'snes',
			[entry({ kind: 'raw', sha1: '827c071f8aebe93f80576800266f74f82ff9e41b' })],
			snes,
		)
		expect(defined(res.files[0]).matchLevel).toBe('verified')
	})

	it('matches an rvz by serial code', () => {
		const res = auditSystem(
			'gamecube',
			[entry({ system: 'gamecube', kind: 'rvz', serial: 'GW7P' })],
			gamecube,
		)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('serial')
		expect(file.datEntryName).toBe('007 - Agent Under Fire (Europe)')
	})

	it('matches an rvz by serial code whatever the case it arrives in', () => {
		const res = auditSystem(
			'gamecube',
			[entry({ system: 'gamecube', kind: 'rvz', serial: 'gw7p' })],
			gamecube,
		)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('serial')
		expect(file.datEntryName).toBe('007 - Agent Under Fire (Europe)')
	})

	it('falls back to the file name when no hash matches', () => {
		const res = auditSystem(
			'snes',
			[entry({ kind: 'chd', path: '/roms/snes/Super Mario World (USA).chd' })],
			snes,
		)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('named')
		expect(file.datEntryName).toBe('Super Mario World (USA)')
	})

	it('reports unknown for a file nothing recognises', () => {
		const res = auditSystem(
			'snes',
			[entry({ crc32: 'deadbeef', path: '/roms/snes/hack.zip' })],
			snes,
		)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('unknown')
		expect(file.datEntryName).toBeUndefined()
	})

	it('counts rom entries raw, not games', () => {
		const res = auditSystem('snes', [entry({ crc32: '8f24f886' })], snes)
		expect(res.totalRomEntries).toBe(4)
		expect(res.matchedRomEntries).toBe(1)
	})

	it('groups every variant of a title under one canonical game', () => {
		const res = auditSystem('snes', [], snes)
		const mario = res.games.find((g) => g.title === 'Super Mario World')
		expect(mario?.entries).toHaveLength(2)
	})

	it('marks a game owned when any one of its roms matches', () => {
		const res = auditSystem('snes', [entry({ crc32: 'b19ed489' })], snes)
		const mario = res.games.find((g) => g.title === 'Super Mario World')
		expect(mario?.owned).toBe(true)
		expect(res.missingGames.map((g) => g.title)).not.toContain('Super Mario World')
	})

	it('lists a game as missing when none of its roms matches', () => {
		const res = auditSystem('snes', [], snes)
		expect(res.missingGames.map((g) => g.title)).toContain('Super Mario World')
		expect(res.missingGames.map((g) => g.title)).toContain('Dragon Ball Z - La Legende Saien')
	})

	it('never matches the same dat entry twice', () => {
		const res = auditSystem(
			'snes',
			[entry({ crc32: '8f24f886' }), entry({ crc32: '8f24f886', path: '/roms/snes/dup.zip' })],
			snes,
		)
		expect(res.matchedRomEntries).toBe(1)
		expect(res.files.filter((f) => f.matchLevel === 'verified')).toHaveLength(2)
	})

	// "Tales of Symphonia" (Disc 1 / Disc 2) share one serial code (GYTP) in the
	// gamecube fixture — the ambiguous-bucket branch of matchOne.
	it('resolves an ambiguous serial code when the file name matches one entry exactly', () => {
		const res = auditSystem(
			'gamecube',
			[
				entry({
					system: 'gamecube',
					kind: 'rvz',
					serial: 'GYTP',
					path: '/roms/gamecube/Tales of Symphonia (Europe) (Disc 1).iso',
				}),
			],
			gamecube,
		)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('serial')
		expect(file.datEntryName).toBe('Tales of Symphonia (Europe) (Disc 1)')
	})

	it('falls back cleanly, without guessing, when an ambiguous serial code is not settled by the name', () => {
		const res = auditSystem(
			'gamecube',
			[
				entry({
					system: 'gamecube',
					kind: 'rvz',
					serial: 'GYTP',
					path: '/roms/gamecube/ToS Bundle.iso',
				}),
			],
			gamecube,
		)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('unknown')
		expect(file.datEntryName).toBeUndefined()
	})

	// The RVZ/GC-Wii disc header's discNumber field is 0-based (0 = disc 1),
	// unlike the DAT's 1-based "(Disc N)" name tag.
	it('resolves an ambiguous serial code via discNumber when the file name does not reproduce the disc tag', () => {
		const res = auditSystem(
			'gamecube',
			[
				entry({
					system: 'gamecube',
					kind: 'rvz',
					serial: 'GYTP',
					discNumber: 0,
					path: '/roms/gamecube/Tales of Symphonia.rvz',
				}),
			],
			gamecube,
		)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('serial')
		expect(file.datEntryName).toBe('Tales of Symphonia (Europe) (Disc 1)')
	})

	it('picks the second disc from discNumber 1', () => {
		const res = auditSystem(
			'gamecube',
			[
				entry({
					system: 'gamecube',
					kind: 'rvz',
					serial: 'GYTP',
					discNumber: 1,
					path: '/roms/gamecube/Tales of Symphonia.rvz',
				}),
			],
			gamecube,
		)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('serial')
		expect(file.datEntryName).toBe('Tales of Symphonia (Europe) (Disc 2)')
	})

	it('does not let discNumber override an exact file-name match', () => {
		const res = auditSystem(
			'gamecube',
			[
				entry({
					system: 'gamecube',
					kind: 'rvz',
					serial: 'GYTP',
					// Wrong disc number on purpose — the exact name match must win.
					discNumber: 1,
					path: '/roms/gamecube/Tales of Symphonia (Europe) (Disc 1).iso',
				}),
			],
			gamecube,
		)
		expect(defined(res.files[0]).datEntryName).toBe('Tales of Symphonia (Europe) (Disc 1)')
	})

	it('computes ownedDiscs and missingDiscs from the disc tag in the dat name', () => {
		const res = auditSystem(
			'gamecube',
			[entry({ system: 'gamecube', crc32: 'd3f5f96e' })],
			gamecube,
		)
		const tales = res.games.find((g) => g.title === 'Tales of Symphonia')
		expect(tales?.owned).toBe(true)
		expect(tales?.ownedDiscs).toEqual([1])
		expect(tales?.missingDiscs).toEqual([2])
	})

	it('lists every disc as missing when none of a multi-disc game is owned', () => {
		const res = auditSystem('gamecube', [], gamecube)
		const tales = res.games.find((g) => g.title === 'Tales of Symphonia')
		expect(tales?.owned).toBe(false)
		expect(tales?.ownedDiscs).toEqual([])
		expect(tales?.missingDiscs).toEqual([1, 2])
	})

	// Keeping only the first entry per hash left every later one permanently
	// unmatchable, so its canonical game stayed missing however many copies of
	// the file were on the box — a false missing, not a display quirk.
	it('marks every dat entry sharing a hash, not just the first', () => {
		const res = auditSystem('psx', [entry({ system: 'psx', crc32: 'aabbccdd' })], sharedHash)
		expect(res.matchedRomEntries).toBe(2)
		expect(res.missingGames.map((g) => g.title)).toEqual(['Vagrant Story'])
	})

	it('reports the first entry of a shared hash as the matched dat name', () => {
		const res = auditSystem('psx', [entry({ system: 'psx', crc32: 'aabbccdd' })], sharedHash)
		const file = defined(res.files[0])
		expect(file.matchLevel).toBe('verified')
		expect(file.datEntryName).toBe('Chrono Cross (USA) (Disc 1)')
	})

	it('marks every dat entry sharing a sha1, not just the first', () => {
		const res = auditSystem(
			'psx',
			[entry({ system: 'psx', kind: 'raw', sha1: '3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f' })],
			sharedHash,
		)
		expect(res.matchedRomEntries).toBe(2)
	})

	it('ignores manifest files from a system other than the one being audited', () => {
		const res = auditSystem('snes', [entry({ system: 'gamecube', crc32: '8f24f886' })], snes)
		expect(res.files).toHaveLength(0)
		expect(res.matchedRomEntries).toBe(0)
	})
})

describe('filterMissingGames', () => {
	it('keeps only games available in the requested region', () => {
		const res = auditSystem('snes', [], snes)
		const usa = filterMissingGames(res.missingGames, { regions: ['USA'] })
		expect(usa.map((g) => g.title)).toEqual(['Super Mario World'])
	})

	it('excludes categories on request', () => {
		const res = auditSystem('snes', [], snes)
		expect(res.missingGames.map((g) => g.title)).toContain('Star Fox 2')
		const kept = filterMissingGames(res.missingGames, { excludeCategories: ['proto'] })
		expect(kept.map((g) => g.title)).not.toContain('Star Fox 2')
		expect(kept).toHaveLength(res.missingGames.length - 1)
	})

	// A canonical game's categories are the union of its variants'. Excluding on
	// that union made a genuinely missing commercial release vanish the moment
	// the title also had a proto entry — the filters restrict the display, they
	// must never drop a real missing game.
	it('keeps a game whose commercial variant is missing even when a sibling variant is a proto', () => {
		const res = auditSystem('snes', [], protoVariants)
		const kept = filterMissingGames(res.missingGames, { excludeCategories: ['proto'] })
		expect(kept.map((g) => g.title)).toContain('Star Fox 2')
	})

	it('still excludes a game whose every variant carries the excluded category', () => {
		const res = auditSystem('snes', [], protoVariants)
		const kept = filterMissingGames(res.missingGames, { excludeCategories: ['proto'] })
		expect(kept.map((g) => g.title)).not.toContain('Bio Force Ape')
	})
})
