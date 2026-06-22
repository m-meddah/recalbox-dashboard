import os from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
	artworkKey,
	contentTypeForPath,
	isLocalStorage,
	putObject,
	readLocal,
} from '../index'

let dir: string

beforeAll(() => {
	dir = path.join(os.tmpdir(), `sr-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	process.env.STORAGE_DIR = dir
	process.env.BLOB_READ_WRITE_TOKEN = ''
})

afterAll(async () => {
	await rm(dir, { recursive: true, force: true })
})

describe('artworkKey', () => {
	it('is stable, namespaced by recalbox, and keeps the extension', () => {
		const k = artworkKey('rb1', '/recalbox/share/roms/snes/Super Mario World.png')
		expect(k).toMatch(/^artwork\/rb1\/[0-9a-f]{40}\.png$/)
		// deterministic
		expect(artworkKey('rb1', '/recalbox/share/roms/snes/Super Mario World.png')).toBe(k)
		// path-dependent
		expect(artworkKey('rb1', '/other.png')).not.toBe(k)
	})

	it('falls back to bin for odd extensions', () => {
		expect(artworkKey('rb1', '/x/file.weird-ext')).toMatch(/\.bin$/)
	})
})

describe('contentTypeForPath', () => {
	it('maps known image extensions', () => {
		expect(contentTypeForPath('a.png')).toBe('image/png')
		expect(contentTypeForPath('a.JPG')).toBe('image/jpeg')
		expect(contentTypeForPath('a.unknown')).toBe('application/octet-stream')
	})
})

describe('local storage adapter', () => {
	it('uses local storage when no Blob token is set', () => {
		expect(isLocalStorage()).toBe(true)
	})

	it('stores bytes and reads them back via the key', async () => {
		const key = artworkKey('rb1', '/recalbox/share/roms/snes/x.png')
		const bytes = Buffer.from([1, 2, 3, 4])
		const { url } = await putObject(key, bytes, 'image/png')
		expect(url).toBe(`/api/blob/${key}`)
		const back = await readLocal(key)
		expect(back).not.toBeNull()
		expect(Buffer.from(back as Buffer).equals(bytes)).toBe(true)
	})

	it('returns null for a missing key and refuses path traversal', async () => {
		expect(await readLocal('artwork/rb1/missing.png')).toBeNull()
		expect(await readLocal('../../etc/passwd')).toBeNull()
	})
})
