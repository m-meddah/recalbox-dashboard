import { describe, expect, it } from 'vitest'
import { mediaProxyUrl, mediaSrc } from '../media'

describe('mediaSrc', () => {
	// The serverless win: a resolved url is served by the CDN, so the render must
	// not route through /api/media and burn a function invocation for a 302.
	it('prefers the resolved object-storage url over the proxy', () => {
		expect(mediaSrc('https://blob/a.png', '/recalbox/share/a.png')).toBe('https://blob/a.png')
	})

	// Self-hosted has no artwork rows, so every call lands here and behaves as before.
	it('falls back to the media proxy when no url is resolved', () => {
		expect(mediaSrc(null, '/recalbox/share/a.png')).toBe(
			'/api/media?path=%2Frecalbox%2Fshare%2Fa.png',
		)
		expect(mediaSrc(undefined, '/recalbox/share/a.png')).toBe(
			'/api/media?path=%2Frecalbox%2Fshare%2Fa.png',
		)
	})

	it('returns null when there is neither a url nor a path', () => {
		expect(mediaSrc(null, null)).toBeNull()
		expect(mediaSrc(undefined, undefined)).toBeNull()
	})

	it('still uses the url when the path is missing', () => {
		expect(mediaSrc('https://blob/a.png', null)).toBe('https://blob/a.png')
	})
})

describe('mediaProxyUrl', () => {
	it('encodes the path so spaces and ampersands survive the query string', () => {
		expect(mediaProxyUrl('/recalbox/share/roms/Sonic & Knuckles.png')).toBe(
			'/api/media?path=%2Frecalbox%2Fshare%2Froms%2FSonic%20%26%20Knuckles.png',
		)
	})
})
