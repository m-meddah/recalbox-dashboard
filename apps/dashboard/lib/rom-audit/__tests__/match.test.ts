import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDat } from '../dat-parser'
import type { ManifestEntry } from '../manifest'
import { auditSystem, filterMissingGames } from '../match'

const FIXTURES = join(__dirname, '__fixtures__')
const snes = parseDat(readFileSync(join(FIXTURES, 'no-intro-snes.dat'), 'utf-8'))
const gamecube = parseDat(readFileSync(join(FIXTURES, 'redump-gamecube.dat'), 'utf-8'))

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
		expect(res.files[0].matchLevel).toBe('verified')
		expect(res.files[0].datEntryName).toBe('Dragon Ball Z - La Legende Saien (France)')
	})

	it('matches by sha1 when crc32 is absent', () => {
		const res = auditSystem(
			'snes',
			[entry({ kind: 'raw', sha1: '827c071f8aebe93f80576800266f74f82ff9e41b' })],
			snes,
		)
		expect(res.files[0].matchLevel).toBe('verified')
	})

	it('matches an rvz by serial code', () => {
		const res = auditSystem(
			'gamecube',
			[entry({ system: 'gamecube', kind: 'rvz', serial: 'GW7P' })],
			gamecube,
		)
		expect(res.files[0].matchLevel).toBe('serial')
		expect(res.files[0].datEntryName).toBe('007 - Agent Under Fire (Europe)')
	})

	it('falls back to the file name when no hash matches', () => {
		const res = auditSystem(
			'snes',
			[entry({ kind: 'chd', path: '/roms/snes/Super Mario World (USA).chd' })],
			snes,
		)
		expect(res.files[0].matchLevel).toBe('named')
		expect(res.files[0].datEntryName).toBe('Super Mario World (USA)')
	})

	it('reports unknown for a file nothing recognises', () => {
		const res = auditSystem(
			'snes',
			[entry({ crc32: 'deadbeef', path: '/roms/snes/hack.zip' })],
			snes,
		)
		expect(res.files[0].matchLevel).toBe('unknown')
		expect(res.files[0].datEntryName).toBeUndefined()
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
})
