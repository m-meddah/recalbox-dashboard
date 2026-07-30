import type { RomSystemAuditRow } from '@/lib/db/rom-audit-queries'
import { describe, expect, it } from 'vitest'
import type { Dat } from '../dat-parser'
import { missingGamesFor, missingGamesToCsv, toOverview } from '../report'

const SCANNED_AT = new Date('2026-07-26T10:00:00Z')

function row(over: Partial<RomSystemAuditRow> = {}): RomSystemAuditRow {
	return {
		recalboxId: 'rb1',
		system: 'snes',
		datName: 'Nintendo - Super Nintendo Entertainment System',
		datVersion: '2026.05.02',
		totalRomEntries: 4000,
		matchedRomEntries: 1200,
		verifiedCount: 1150,
		serialCount: 0,
		namedCount: 50,
		unknownCount: 7,
		filesScanned: 1207,
		totalBytes: 12345678,
		mounts: ['/recalbox/share'],
		matchedEntries: [],
		scannedAt: SCANNED_AT,
		...over,
	}
}

const DAT: Dat = {
	name: 'Sega - Game Gear',
	version: '2026.05.02',
	games: [
		{
			name: 'Sonic (Europe)',
			region: 'Europe',
			roms: [{ name: 'Sonic (Europe).gg', size: 1024, crc: 'aaaa1111', md5: 'm1', sha1: 's1' }],
		},
		{
			name: 'Sonic (USA)',
			region: 'USA',
			roms: [{ name: 'Sonic (USA).gg', size: 1024, crc: 'bbbb2222' }],
		},
		{
			name: 'Columns (Japan)',
			region: 'Japan',
			roms: [{ name: 'Columns (Japan).gg', size: 512, crc: 'cccc3333' }],
		},
		{
			name: 'Proto Thing (USA) (Proto)',
			region: 'USA',
			roms: [{ name: 'Proto Thing (USA) (Proto).gg', size: 256, crc: 'dddd4444' }],
		},
	],
}

describe('toOverview', () => {
	it('computes the raw percentage', () => {
		expect(toOverview(row({ totalRomEntries: 4000, matchedRomEntries: 1200 })).percent).toBe(30)
	})

	// "Inventory only" is not "0 % complete" — the latter claims an empty
	// collection, which is a different and wrong statement.
	it('has no percentage for a system with no catalogue', () => {
		const o = toOverview(row({ totalRomEntries: 0, matchedRomEntries: 0, datName: null }))
		expect(o.percent).toBeNull()
	})

	it('carries the counts and the supports', () => {
		const o = toOverview(row())
		expect(o.verified).toBe(1150)
		expect(o.named).toBe(50)
		expect(o.unknown).toBe(7)
		expect(o.mounts).toEqual(['/recalbox/share'])
		expect(o.scannedAt).toBe('2026-07-26T10:00:00.000Z')
	})

	it('tolerates a row with no mounts recorded', () => {
		expect(toOverview(row({ mounts: null })).mounts).toEqual([])
	})
})

describe('missingGamesFor', () => {
	it('returns the games no matched entry covers', () => {
		const missing = missingGamesFor(DAT, ['Sonic (Europe)'])
		expect(missing.map((g) => g.title).sort()).toEqual(['Columns', 'Proto Thing'])
	})

	// The spec's rule: one matched rom is enough to own the game, whatever the
	// region or revision it came from.
	it('treats a game as owned as soon as one of its roms is matched', () => {
		const missing = missingGamesFor(DAT, ['Sonic (USA)'])
		expect(missing.map((g) => g.title)).not.toContain('Sonic')
	})

	it('returns the whole catalogue when nothing is matched', () => {
		expect(missingGamesFor(DAT, [])).toHaveLength(3)
	})

	it('returns nothing when everything is matched', () => {
		const all = DAT.games.map((g) => g.name)
		expect(missingGamesFor(DAT, all)).toEqual([])
	})

	it('applies the region filter', () => {
		const missing = missingGamesFor(DAT, [], { regions: ['Japan'] })
		expect(missing.map((g) => g.title)).toEqual(['Columns'])
	})

	// Categories come out of the tag parser lower-cased ('proto', not 'Proto').
	// The HTTP layer normalises what the query string sends, or the filter would
	// silently match nothing.
	it('applies the category filter, whose vocabulary is lower-case', () => {
		const missing = missingGamesFor(DAT, [], { excludeCategories: ['proto'] })
		expect(missing.map((g) => g.title)).not.toContain('Proto Thing')
	})
})

describe('missingGamesToCsv', () => {
	it('emits the header the spec asks for', () => {
		const csv = missingGamesToCsv(missingGamesFor(DAT, []))
		expect(csv.split('\n')[0]).toBe('title,region,datEntry,size,crc32,md5,sha1,serial')
	})

	it('emits one line per dat entry with its hashes', () => {
		const csv = missingGamesToCsv(
			missingGamesFor(DAT, ['Columns (Japan)', 'Proto Thing (USA) (Proto)']),
		)
		const lines = csv.trim().split('\n')
		expect(lines).toHaveLength(3) // header + the two Sonic entries
		expect(lines[1]).toContain('aaaa1111')
		expect(lines[1]).toContain('Sonic (Europe).gg')
	})

	it('quotes a title containing a comma or a quote', () => {
		const dat: Dat = {
			name: 'x',
			version: '1',
			games: [{ name: 'Hello, "World" (USA)', roms: [{ name: 'a.gg', size: 1 }] }],
		}
		const csv = missingGamesToCsv(missingGamesFor(dat, []))
		expect(csv).toContain('"Hello, ""World"""')
	})

	// Excel executes a cell starting with =, +, - or @; a real title can start
	// with a dash, so the cell is prefixed rather than rewritten.
	it('neutralises a formula-looking value', () => {
		const dat: Dat = {
			name: 'x',
			version: '1',
			games: [{ name: '=cmd|calc (USA)', roms: [{ name: 'a.gg', size: 1 }] }],
		}
		const csv = missingGamesToCsv(missingGamesFor(dat, []))
		expect(csv).toContain("'=cmd|calc")
		expect(csv).not.toMatch(/(^|,)=cmd/)
	})

	it('emits a header alone when nothing is missing', () => {
		expect(missingGamesToCsv([])).toBe('title,region,datEntry,size,crc32,md5,sha1,serial\n')
	})
})
