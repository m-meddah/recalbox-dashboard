import { describe, expect, it } from 'vitest'
import { parseManifest, parseManifestLenient } from '../manifest'
import { defined } from './test-helpers'

const valid = {
	path: '/recalbox/share/roms/snes/Zelda.zip',
	size: 1048576,
	mtime: 1721900000,
	system: 'snes',
	mount: '/recalbox/share',
	kind: 'zip-entry',
	crc32: 'e95a3dd7',
	innerName: 'Zelda (Europe).sfc',
}

describe('parseManifest', () => {
	it('accepts a well-formed entry', () => {
		const entry = defined(parseManifest([valid])[0])
		expect(entry.path).toBe(valid.path)
		expect(entry.crc32).toBe('e95a3dd7')
	})

	it('lowercases hashes coming from the box', () => {
		const entry = defined(parseManifest([{ ...valid, crc32: 'E95A3DD7' }])[0])
		expect(entry.crc32).toBe('e95a3dd7')
	})

	it('accepts an entry with no hash at all', () => {
		const entry = defined(parseManifest([{ ...valid, kind: 'raw', crc32: undefined }])[0])
		expect(entry.crc32).toBeUndefined()
	})

	it('accepts a chd entry carrying sha1 and rawSha1', () => {
		const entry = defined(
			parseManifest([
				{
					...valid,
					kind: 'chd',
					crc32: undefined,
					sha1: 'AA'.repeat(20),
					rawSha1: 'BB'.repeat(20),
				},
			])[0],
		)
		expect(entry.sha1).toBe('aa'.repeat(20))
		expect(entry.rawSha1).toBe('bb'.repeat(20))
	})

	it('accepts an rvz entry carrying a serial', () => {
		const entry = defined(
			parseManifest([
				{ ...valid, kind: 'rvz', crc32: undefined, serial: 'GW7P', discNumber: 0, discVersion: 0 },
			])[0],
		)
		expect(entry.serial).toBe('GW7P')
	})

	it('rejects an entry without a path', () => {
		expect(() => parseManifest([{ ...valid, path: undefined }])).toThrow()
	})

	it('rejects an unknown kind', () => {
		expect(() => parseManifest([{ ...valid, kind: 'floppy' }])).toThrow()
	})

	it('rejects a non-array input', () => {
		expect(() => parseManifest({ path: 'x' })).toThrow()
	})

	it('lowercases an uppercase md5', () => {
		const entry = defined(parseManifest([{ ...valid, crc32: undefined, md5: 'AB'.repeat(16) }])[0])
		expect(entry.md5).toBe('ab'.repeat(16))
	})

	it('rejects a crc32 that is not 8 hex characters', () => {
		expect(() => parseManifest([{ ...valid, crc32: 'a' }])).toThrow()
	})

	it('rejects an md5 that is not 32 hex characters', () => {
		expect(() => parseManifest([{ ...valid, crc32: undefined, md5: 'ab'.repeat(10) }])).toThrow()
	})

	it('rejects a sha1 that is not 40 hex characters', () => {
		expect(() =>
			parseManifest([{ ...valid, kind: 'chd', crc32: undefined, sha1: 'aa'.repeat(10) }]),
		).toThrow()
	})

	it('rejects a rawSha1 that is not 40 hex characters', () => {
		expect(() =>
			parseManifest([{ ...valid, kind: 'chd', crc32: undefined, rawSha1: 'bb'.repeat(10) }]),
		).toThrow()
	})

	it('rejects rawSha1 on a kind other than chd', () => {
		expect(() =>
			parseManifest([{ ...valid, kind: 'zip-entry', rawSha1: 'bb'.repeat(20) }]),
		).toThrow()
	})

	it('rejects serial on a kind other than rvz', () => {
		expect(() => parseManifest([{ ...valid, kind: 'zip-entry', serial: 'GW7P' }])).toThrow()
	})

	it('rejects discNumber on a kind other than rvz', () => {
		expect(() => parseManifest([{ ...valid, kind: 'zip-entry', discNumber: 0 }])).toThrow()
	})

	it('rejects discVersion on a kind other than rvz', () => {
		expect(() => parseManifest([{ ...valid, kind: 'zip-entry', discVersion: 0 }])).toThrow()
	})

	it('accepts crc32/md5/sha1 together on any kind', () => {
		const entry = defined(
			parseManifest([
				{
					...valid,
					kind: 'sevenzip-entry',
					crc32: 'e95a3dd7',
					md5: 'ab'.repeat(16),
					sha1: 'cd'.repeat(20),
				},
			])[0],
		)
		expect(entry.md5).toBe('ab'.repeat(16))
		expect(entry.sha1).toBe('cd'.repeat(20))
	})

	// Hashes are normalised at the validation boundary; the serial was left raw,
	// so a lowercase game code silently fell through to a name match.
	it('uppercases a serial coming from the box', () => {
		const entry = defined(
			parseManifest([{ ...valid, kind: 'rvz', crc32: undefined, serial: 'gw7p' }])[0],
		)
		expect(entry.serial).toBe('GW7P')
	})

	it('rejects a serial that is not alphanumeric', () => {
		expect(() =>
			parseManifest([{ ...valid, kind: 'rvz', crc32: undefined, serial: 'GW-P' }]),
		).toThrow()
	})

	it('rejects a serial that is not 4 characters', () => {
		expect(() =>
			parseManifest([{ ...valid, kind: 'rvz', crc32: undefined, serial: 'ABCDE' }]),
		).toThrow()
	})

	it('rejects a path containing a ".." segment', () => {
		expect(() =>
			parseManifest([{ ...valid, path: '/recalbox/share/roms/../etc/passwd' }]),
		).toThrow()
	})

	it('rejects a mount containing a ".." segment', () => {
		expect(() => parseManifest([{ ...valid, mount: '/recalbox/share/..' }])).toThrow()
	})

	it('rejects a path containing a null byte', () => {
		expect(() =>
			parseManifest([{ ...valid, path: '/recalbox/share/roms/snes/Zelda.zip\x00' }]),
		).toThrow()
	})

	it('rejects a path containing a newline', () => {
		expect(() =>
			parseManifest([{ ...valid, path: '/recalbox/share/roms/snes/Zelda.zip\n' }]),
		).toThrow()
	})

	it('rejects a mount containing a control character', () => {
		expect(() => parseManifest([{ ...valid, mount: '/recalbox/share\r' }])).toThrow()
	})

	// innerName reaches a shell as an extraction argument, and system becomes a
	// path segment and a database key. The schema is the trust boundary for a
	// manifest pushed over HTTP by a remote box — it has to cover them too.
	it('rejects an innerName containing a ".." segment', () => {
		expect(() => parseManifest([{ ...valid, innerName: '../../etc/passwd' }])).toThrow()
	})

	it('rejects an innerName containing a null byte', () => {
		expect(() => parseManifest([{ ...valid, innerName: 'Zelda.sfc\x00' }])).toThrow()
	})

	it('rejects an innerName containing a newline', () => {
		expect(() => parseManifest([{ ...valid, innerName: 'Zelda.sfc\nrm -rf /' }])).toThrow()
	})

	it('rejects an empty innerName', () => {
		expect(() => parseManifest([{ ...valid, innerName: '' }])).toThrow()
	})

	// `SNES` used to be rejected here too, back when this field was a whitelist of
	// catalogued slugs. It is a legitimate directory name and is now accepted —
	// see 'accepts a directory name that is not a catalogued system slug'. What a
	// system id must never do is widen into a path, and that still holds.
	it('rejects a system that could escape its directory', () => {
		expect(() => parseManifest([{ ...valid, system: '../snes' }])).toThrow()
		expect(() => parseManifest([{ ...valid, system: 'snes/nes' }])).toThrow()
		expect(() => parseManifest([{ ...valid, system: 'snes\x00' }])).toThrow()
	})

	it('rejects an unreasonably long system id', () => {
		expect(() => parseManifest([{ ...valid, system: 'a'.repeat(65) }])).toThrow()
	})

	it('accepts the system id forms the recalbox catalogue actually uses', () => {
		for (const system of ['snes', 'gamecube', 'pcenginecd', 'atari2600', 'msx1', 'neogeocd']) {
			expect(defined(parseManifest([{ ...valid, system }])[0]).system).toBe(system)
		}
	})

	// A whole scan must not abort over a stray directory: real disks carry
	// @eaDir, .stversions and hand-made folders, and the spec requires listing
	// every /roms directory — an unmapped one degrades to inventory-only.
	it('accepts a directory name that is not a catalogued system slug', () => {
		for (const system of ['@eaDir', '.stversions', 'Mes Jeux', 'NES']) {
			expect(defined(parseManifest([{ ...valid, system }])[0]).system).toBe(system)
		}
	})

	it('still rejects a system id that could widen into a path', () => {
		expect(() => parseManifest([{ ...valid, system: 'a/b' }])).toThrow()
		expect(() => parseManifest([{ ...valid, system: 'a\\b' }])).toThrow()
		expect(() => parseManifest([{ ...valid, system: '..' }])).toThrow()
	})
})

// The HTTP boundary needs the opposite contract from a local scan: one odd entry
// pushed by a remote box must not discard that system's whole scan.
describe('parseManifestLenient', () => {
	it('keeps the valid entries and counts the rejected ones', () => {
		const res = parseManifestLenient([
			valid,
			{ ...valid, kind: 'floppy' },
			{ ...valid, path: '/b' },
		])
		expect(res.entries).toHaveLength(2)
		expect(res.rejected).toBe(1)
	})

	it('normalises exactly like parseManifest', () => {
		const res = parseManifestLenient([{ ...valid, crc32: 'E95A3DD7' }])
		expect(defined(res.entries[0]).crc32).toBe('e95a3dd7')
	})

	it('returns empty on a non-array input instead of throwing', () => {
		expect(parseManifestLenient({})).toEqual({ entries: [], rejected: 0 })
		expect(parseManifestLenient(null)).toEqual({ entries: [], rejected: 0 })
	})

	it('rejects everything without throwing when nothing is valid', () => {
		const res = parseManifestLenient([{ nope: 1 }, { nope: 2 }])
		expect(res.entries).toEqual([])
		expect(res.rejected).toBe(2)
	})

	// The path guards are not relaxed just because the parse is lenient.
	it('still drops an entry whose path escapes', () => {
		const res = parseManifestLenient([{ ...valid, path: '/roms/../etc/passwd' }])
		expect(res.entries).toEqual([])
		expect(res.rejected).toBe(1)
	})
})
