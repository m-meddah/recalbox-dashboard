import { describe, expect, it } from 'vitest'
import { artworkContentType, contentTypeForPath, looksLikeImage } from '../index'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex')
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(4)])
const WEBP = Buffer.concat([
	Buffer.from('RIFF', 'latin1'),
	Buffer.alloc(4),
	Buffer.from('WEBP', 'latin1'),
])
const BMP = Buffer.concat([Buffer.from('BM', 'latin1'), Buffer.alloc(10)])
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8')

describe('artworkContentType', () => {
	it.each([
		['/recalbox/share/a.png', 'image/png'],
		['/recalbox/share/a.jpg', 'image/jpeg'],
		['/recalbox/share/a.JPEG', 'image/jpeg'],
		['/recalbox/share/a.webp', 'image/webp'],
		['/recalbox/share/a.gif', 'image/gif'],
		['/recalbox/share/a.bmp', 'image/bmp'],
	])('types %s as %s', (path, expected) => {
		expect(artworkContentType(path)).toBe(expected)
	})

	it.each([
		'/recalbox/share/evil.html',
		'/recalbox/share/evil.htm',
		'/recalbox/share/evil.js',
		'/recalbox/share/payload.exe',
		'/recalbox/share/noextension',
	])('refuses %s instead of falling back to octet-stream', (path) => {
		expect(artworkContentType(path)).toBeNull()
		// contentTypeForPath (used when SERVING) still has its lenient fallback; the
		// upload path must be the strict one.
		expect(contentTypeForPath(path)).toBe('application/octet-stream')
	})

	it('refuses SVG, the one image format that can carry script', () => {
		expect(artworkContentType('/recalbox/share/a.svg')).toBeNull()
	})
})

describe('looksLikeImage', () => {
	it.each([
		['png', PNG],
		['jpeg', JPEG],
		['gif', GIF],
		['webp', WEBP],
		['bmp', BMP],
	])('accepts %s bytes', (_name, bytes) => {
		expect(looksLikeImage(bytes)).toBe(true)
	})

	it('rejects HTML dressed up as an image', () => {
		expect(looksLikeImage(HTML)).toBe(false)
	})

	it('rejects arbitrary and truncated payloads', () => {
		expect(looksLikeImage(Buffer.from([1, 2, 3]))).toBe(false)
		expect(looksLikeImage(Buffer.alloc(0))).toBe(false)
		// "RIFF" alone is not WebP (could be a WAV) — the WEBP tag must be present.
		expect(looksLikeImage(Buffer.from('RIFF....WAVE', 'latin1'))).toBe(false)
	})

	it('accepts a mislabelled but genuine image, which scraped artwork often is', () => {
		// A .png that really holds JPEG bytes: still an image, so still allowed.
		expect(artworkContentType('/recalbox/share/a.png')).toBe('image/png')
		expect(looksLikeImage(JPEG)).toBe(true)
	})
})
