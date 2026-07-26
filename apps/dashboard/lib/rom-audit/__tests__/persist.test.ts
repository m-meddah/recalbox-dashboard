import { describe, expect, it } from 'vitest'
import type { AuditResult, MatchedFile } from '../match'
import { auditToFileRows, auditToSystemRow, persistPolicyFor } from '../persist'

const SCANNED_AT = new Date('2026-07-26T10:00:00Z')

function matched(over: Partial<MatchedFile> = {}): MatchedFile {
	return {
		path: '/recalbox/share/roms/snes/Game.zip',
		size: 1048576,
		mtime: 1721900000,
		system: 'snes',
		mount: '/recalbox/share',
		kind: 'zip-entry',
		crc32: 'e95a3dd7',
		innerName: 'Game (Europe).sfc',
		matchLevel: 'verified',
		datEntryName: 'Game (Europe).sfc',
		canonicalTitle: 'Game',
		...over,
	} as MatchedFile
}

function result(files: MatchedFile[], over: Partial<AuditResult> = {}): AuditResult {
	return {
		system: 'snes',
		datName: 'Nintendo - Super Nintendo Entertainment System',
		datVersion: '2026.05.02',
		totalRomEntries: 4000,
		matchedRomEntries: files.filter((f) => f.matchLevel !== 'unknown').length,
		files,
		games: [],
		missingGames: [],
		...over,
	}
}

describe('persistPolicyFor', () => {
	it('keeps the full detail on a self-hosted deploy', () => {
		expect(persistPolicyFor(false)).toBe('detail')
	})

	// The user's explicit choice: the cloud gets aggregates, never 75k rows.
	it('keeps only aggregates in the cloud', () => {
		expect(persistPolicyFor(true)).toBe('aggregates')
	})
})

describe('auditToSystemRow', () => {
	it('counts the files by match level', () => {
		const row = auditToSystemRow(
			'rb1',
			result([
				matched(),
				matched({ path: '/b.zip', matchLevel: 'named' }),
				matched({ path: '/c.rvz', matchLevel: 'serial', innerName: undefined }),
				matched({ path: '/d.zip', matchLevel: 'unknown', datEntryName: undefined }),
			]),
			['/recalbox/share'],
			SCANNED_AT,
		)
		expect(row.verifiedCount).toBe(1)
		expect(row.namedCount).toBe(1)
		expect(row.serialCount).toBe(1)
		expect(row.unknownCount).toBe(1)
		expect(row.filesScanned).toBe(4)
	})

	it('carries the catalogue identity and the raw metric', () => {
		const row = auditToSystemRow('rb1', result([matched()]), ['/recalbox/share'], SCANNED_AT)
		expect(row.datName).toBe('Nintendo - Super Nintendo Entertainment System')
		expect(row.datVersion).toBe('2026.05.02')
		expect(row.totalRomEntries).toBe(4000)
		expect(row.matchedRomEntries).toBe(1)
		expect(row.recalboxId).toBe('rb1')
		expect(row.system).toBe('snes')
		expect(row.scannedAt).toBe(SCANNED_AT)
	})

	// This list is what makes the missing-games view computable without ever
	// reading rom_files — it is the reason the cloud can drop the detail.
	it('lists the matched dat entries, deduplicated and sorted', () => {
		const row = auditToSystemRow(
			'rb1',
			result([
				matched({ datEntryName: 'B.sfc' }),
				matched({ path: '/b.zip', datEntryName: 'A.sfc' }),
				matched({ path: '/c.zip', datEntryName: 'A.sfc' }),
				matched({ path: '/d.zip', matchLevel: 'unknown', datEntryName: undefined }),
			]),
			['/recalbox/share'],
			SCANNED_AT,
		)
		expect(row.matchedEntries).toEqual(['A.sfc', 'B.sfc'])
	})

	it('sums the scanned bytes and keeps the mounts', () => {
		const row = auditToSystemRow(
			'rb1',
			result([matched({ size: 100 }), matched({ path: '/b.zip', size: 200 })]),
			['/recalbox/share', '/recalbox/share/externals/usb0'],
			SCANNED_AT,
		)
		expect(row.totalBytes).toBe(300)
		expect(row.mounts).toEqual(['/recalbox/share', '/recalbox/share/externals/usb0'])
	})

	// A system with no catalogue is inventory-only: a valid, expected state.
	it('accepts a system with no catalogue', () => {
		const row = auditToSystemRow(
			'rb1',
			result([matched({ matchLevel: 'unknown', datEntryName: undefined })], {
				datName: '',
				datVersion: '',
				totalRomEntries: 0,
				matchedRomEntries: 0,
			}),
			['/recalbox/share'],
			SCANNED_AT,
		)
		expect(row.totalRomEntries).toBe(0)
		expect(row.unknownCount).toBe(1)
		expect(row.matchedEntries).toEqual([])
	})
})

describe('auditToFileRows', () => {
	const files = [
		matched(),
		matched({ path: '/b.zip', matchLevel: 'named' }),
		matched({ path: '/c.zip', matchLevel: 'unknown', datEntryName: undefined }),
	]

	it('keeps every file in detail mode', () => {
		expect(auditToFileRows('rb1', result(files), 'detail', SCANNED_AT)).toHaveLength(3)
	})

	it('keeps only the unknown files in aggregates mode', () => {
		const rows = auditToFileRows('rb1', result(files), 'aggregates', SCANNED_AT)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.matchLevel).toBe('unknown')
	})

	it('builds a distinct key for two entries of the same archive', () => {
		const rows = auditToFileRows(
			'rb1',
			result([
				matched({ path: '/set.7z', innerName: 'A.nes', kind: 'sevenzip-entry' }),
				matched({ path: '/set.7z', innerName: 'B.nes', kind: 'sevenzip-entry' }),
			]),
			'detail',
			SCANNED_AT,
		)
		expect(new Set(rows.map((r) => r.entryKey)).size).toBe(2)
	})

	it('maps every column the audit produced', () => {
		const rows = auditToFileRows(
			'rb1',
			result([matched({ sha1: 'a'.repeat(40), serial: 'DL-DOL-GW7P-EUR' })]),
			'detail',
			SCANNED_AT,
		)
		const row = rows[0]
		expect(row?.recalboxId).toBe('rb1')
		expect(row?.system).toBe('snes')
		expect(row?.mount).toBe('/recalbox/share')
		expect(row?.path).toBe('/recalbox/share/roms/snes/Game.zip')
		expect(row?.innerName).toBe('Game (Europe).sfc')
		expect(row?.kind).toBe('zip-entry')
		expect(row?.crc32).toBe('e95a3dd7')
		expect(row?.sha1).toBe('a'.repeat(40))
		expect(row?.serial).toBe('DL-DOL-GW7P-EUR')
		expect(row?.matchLevel).toBe('verified')
		expect(row?.datEntryName).toBe('Game (Europe).sfc')
		expect(row?.canonicalTitle).toBe('Game')
		expect(row?.scannedAt).toBe(SCANNED_AT)
	})

	// Drizzle writes `undefined` as "column absent", which on an update leaves the
	// previous value in place — an optional field must become an explicit null.
	it('turns an absent optional field into null, never undefined', () => {
		const rows = auditToFileRows(
			'rb1',
			result([matched({ matchLevel: 'unknown', datEntryName: undefined, innerName: undefined })]),
			'detail',
			SCANNED_AT,
		)
		expect(rows[0]?.datEntryName).toBeNull()
		expect(rows[0]?.innerName).toBeNull()
		expect(rows[0]?.canonicalTitle ?? null).not.toBeUndefined()
	})

	it('accepts an empty audit', () => {
		expect(auditToFileRows('rb1', result([]), 'detail', SCANNED_AT)).toEqual([])
	})
})
