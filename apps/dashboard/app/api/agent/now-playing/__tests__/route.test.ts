import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const upsertNowPlaying = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/db/now-playing', () => ({
	upsertNowPlaying: (...a: unknown[]) => upsertNowPlaying(...a),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { POST } from '../route'

function req(auth: string | undefined, body: unknown) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (auth ?? null) : null) },
		json: async () => body,
	}
}

afterEach(() => {
	resolveAgentToken.mockReset()
	upsertNowPlaying.mockReset()
})

describe('POST /api/agent/now-playing', () => {
	it('401s without a token', async () => {
		const res = await POST(req(undefined, { playing: true }) as never)
		expect(res.status).toBe(401)
	})

	it('401s on an invalid token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		const res = await POST(req('Bearer x', { playing: true }) as never)
		expect(res.status).toBe(401)
	})

	it('400s when playing is missing', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		const res = await POST(req('Bearer x', { system: 'snes' }) as never)
		expect(res.status).toBe(400)
		expect(upsertNowPlaying).not.toHaveBeenCalled()
	})

	it('upserts a playing state scoped to the token’s Recalbox', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		upsertNowPlaying.mockResolvedValue(undefined)
		const res = await POST(
			req('Bearer x', {
				playing: true,
				system: 'snes',
				system_full_name: 'Super Nintendo',
				rom_path: '/x/smw.sfc',
				game_name: 'Super Mario World',
				started_at: '2026-06-21T20:00:00+00:00',
			}) as never,
		)
		expect(res.status).toBe(201)
		expect(upsertNowPlaying).toHaveBeenCalledWith(
			{},
			'rb1',
			expect.objectContaining({
				playing: true,
				system: 'snes',
				systemFullName: 'Super Nintendo',
				romPath: '/x/smw.sfc',
				gameName: 'Super Mario World',
			}),
		)
	})

	it('accepts a stopped state', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		upsertNowPlaying.mockResolvedValue(undefined)
		const res = await POST(req('Bearer x', { playing: false, rom_path: '/x/smw.sfc' }) as never)
		expect(res.status).toBe(201)
		expect(upsertNowPlaying).toHaveBeenCalledWith(
			{},
			'rb1',
			expect.objectContaining({ playing: false }),
		)
	})
})
