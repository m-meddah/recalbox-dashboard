import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const listWanted = vi.fn()
const saveArtwork = vi.fn()
const putObject = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/db/artwork', () => ({
	listWanted: (...a: unknown[]) => listWanted(...a),
	saveArtwork: (...a: unknown[]) => saveArtwork(...a),
}))
// Storage type/sniff helpers are NOT mocked: their behaviour is the security
// boundary this route relies on, so the real ones run here.
vi.mock('@/lib/storage', async () => {
	const actual = await vi.importActual<typeof import('@/lib/storage')>('@/lib/storage')
	return {
		...actual,
		putObject: (...a: unknown[]) => putObject(...a),
		artworkKey: (rb: string, _p: string) => `artwork/${rb}/key`,
	}
})
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { GET, POST } from '../route'

function req(auth: string | undefined, body?: unknown) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (auth ?? null) : null) },
		json: async () => body,
	}
}

afterEach(() => {
	resolveAgentToken.mockReset()
	listWanted.mockReset()
	saveArtwork.mockReset()
	putObject.mockReset()
})

describe('GET /api/agent/artwork (wanted list)', () => {
	it('401s without a token', async () => {
		expect((await GET(req(undefined) as never)).status).toBe(401)
	})

	it('returns the wanted box paths for the token’s Recalbox', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		listWanted.mockResolvedValue([{ boxPath: '/a.png' }, { boxPath: '/b.png' }])
		const res = await GET(req('Bearer x') as never)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.wanted).toEqual(['/a.png', '/b.png'])
		expect(listWanted).toHaveBeenCalledWith({}, 'rb1')
	})
})

describe('POST /api/agent/artwork (upload)', () => {
	const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
	const okBody = {
		box_path: '/recalbox/share/a.png',
		data: PNG_BYTES.toString('base64'),
	}

	it('401s on an invalid token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		expect((await POST(req('Bearer x', okBody) as never)).status).toBe(401)
	})

	it('400s on an empty payload', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		expect((await POST(req('Bearer x', { box_path: '/a.png' }) as never)).status).toBe(400)
	})

	it('stores the bytes and records the url', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		putObject.mockResolvedValue({ url: 'https://blob/artwork/rb1/key' })
		saveArtwork.mockResolvedValue(undefined)
		const res = await POST(req('Bearer x', okBody) as never)
		expect(res.status).toBe(201)
		const body = await res.json()
		expect(body.url).toBe('https://blob/artwork/rb1/key')
		expect(putObject).toHaveBeenCalledWith('artwork/rb1/key', expect.any(Buffer), 'image/png')
		expect(saveArtwork).toHaveBeenCalledWith(
			{},
			'rb1',
			'/recalbox/share/a.png',
			'https://blob/artwork/rb1/key',
			'image/png',
		)
	})

	it('ignores an agent-supplied content_type', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		putObject.mockResolvedValue({ url: 'https://blob/artwork/rb1/key' })
		saveArtwork.mockResolvedValue(undefined)

		const res = await POST(
			req('Bearer x', { ...okBody, content_type: 'text/html; charset=utf-8' }) as never,
		)

		expect(res.status).toBe(201)
		// Derived from the .png extension, never from the claim in the body.
		expect(putObject).toHaveBeenCalledWith('artwork/rb1/key', expect.any(Buffer), 'image/png')
	})

	it('refuses a non-image path, so no .html object is ever created', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })

		const res = await POST(
			req('Bearer x', {
				box_path: '/recalbox/share/evil.html',
				data: Buffer.from('<script>alert(1)</script>').toString('base64'),
				content_type: 'text/html',
			}) as never,
		)

		expect(res.status).toBe(415)
		expect(putObject).not.toHaveBeenCalled()
		expect(saveArtwork).not.toHaveBeenCalled()
	})

	it('refuses non-image bytes behind an image extension', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })

		const res = await POST(
			req('Bearer x', {
				box_path: '/recalbox/share/a.png',
				data: Buffer.from('<!doctype html><script>alert(1)</script>').toString('base64'),
			}) as never,
		)

		expect(res.status).toBe(415)
		expect(putObject).not.toHaveBeenCalled()
	})

	it('still accepts a mislabelled but genuine image', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		putObject.mockResolvedValue({ url: 'https://blob/artwork/rb1/key' })
		saveArtwork.mockResolvedValue(undefined)

		// JPEG bytes under a .png name — common in scraped artwork, must not break.
		const res = await POST(
			req('Bearer x', {
				box_path: '/recalbox/share/a.png',
				data: Buffer.from('ffd8ffe000104a464946', 'hex').toString('base64'),
			}) as never,
		)

		expect(res.status).toBe(201)
	})
})
