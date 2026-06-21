import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const completeCommand = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/db/agent-commands', () => ({
	completeCommand: (...a: unknown[]) => completeCommand(...a),
}))

import { POST } from '../route'

function req(auth: string | undefined, body: unknown) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (auth ?? null) : null) },
		json: async () => body,
	}
}

afterEach(() => {
	resolveAgentToken.mockReset()
	completeCommand.mockReset()
})

describe('POST /api/agent/commands/result', () => {
	it('401s without a token', async () => {
		const res = await POST(req(undefined, { id: 'c1', ok: true }) as never)
		expect(res.status).toBe(401)
	})

	it('401s on an invalid token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		const res = await POST(req('Bearer x', { id: 'c1', ok: true }) as never)
		expect(res.status).toBe(401)
	})

	it('400s on an invalid payload', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		const res = await POST(req('Bearer x', { ok: true }) as never)
		expect(res.status).toBe(400)
	})

	it('completes the command scoped to the token’s Recalbox', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		completeCommand.mockResolvedValue(true)
		const res = await POST(req('Bearer x', { id: 'c1', ok: true, result: 'a.b=1' }) as never)
		expect(res.status).toBe(200)
		expect(completeCommand).toHaveBeenCalledWith({}, 'rb1', 'c1', true, 'a.b=1')
	})

	it('404s when the command is not found for that Recalbox', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		completeCommand.mockResolvedValue(false)
		const res = await POST(req('Bearer x', { id: 'other', ok: false }) as never)
		expect(res.status).toBe(404)
	})
})
