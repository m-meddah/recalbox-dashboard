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
vi.mock('@/lib/storage', () => ({
	putObject: (...a: unknown[]) => putObject(...a),
	artworkKey: (rb: string, p: string) => `artwork/${rb}/key`,
	contentTypeForPath: () => 'image/png',
}))
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
	const okBody = { box_path: '/recalbox/share/a.png', data: Buffer.from([1, 2, 3]).toString('base64') }

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
})
