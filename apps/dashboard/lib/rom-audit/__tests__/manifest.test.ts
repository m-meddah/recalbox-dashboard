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
})
