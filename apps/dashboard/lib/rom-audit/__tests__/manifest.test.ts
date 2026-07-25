import { describe, expect, it } from 'vitest'
import { parseManifest } from '../manifest'

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
		const [entry] = parseManifest([valid])
		expect(entry.path).toBe(valid.path)
		expect(entry.crc32).toBe('e95a3dd7')
	})

	it('lowercases hashes coming from the box', () => {
		const [entry] = parseManifest([{ ...valid, crc32: 'E95A3DD7' }])
		expect(entry.crc32).toBe('e95a3dd7')
	})

	it('accepts an entry with no hash at all', () => {
		const [entry] = parseManifest([{ ...valid, kind: 'raw', crc32: undefined }])
		expect(entry.crc32).toBeUndefined()
	})

	it('accepts a chd entry carrying sha1 and rawSha1', () => {
		const [entry] = parseManifest([
			{ ...valid, kind: 'chd', crc32: undefined, sha1: 'AA'.repeat(20), rawSha1: 'BB'.repeat(20) },
		])
		expect(entry.sha1).toBe('aa'.repeat(20))
		expect(entry.rawSha1).toBe('bb'.repeat(20))
	})

	it('accepts an rvz entry carrying a serial', () => {
		const [entry] = parseManifest([
			{ ...valid, kind: 'rvz', crc32: undefined, serial: 'GW7P', discNumber: 0, discVersion: 0 },
		])
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
		const [entry] = parseManifest([{ ...valid, crc32: undefined, md5: 'AB'.repeat(16) }])
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
		const [entry] = parseManifest([
			{
				...valid,
				kind: 'sevenzip-entry',
				crc32: 'e95a3dd7',
				md5: 'ab'.repeat(16),
				sha1: 'cd'.repeat(20),
			},
		])
		expect(entry.md5).toBe('ab'.repeat(16))
		expect(entry.sha1).toBe('cd'.repeat(20))
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
})
