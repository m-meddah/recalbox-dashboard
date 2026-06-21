import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const claimPendingCommands = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/db/agent-commands', () => ({
	claimPendingCommands: (...a: unknown[]) => claimPendingCommands(...a),
}))

import { GET } from '../route'

function req(auth: string | undefined) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (auth ?? null) : null) },
	}
}

afterEach(() => {
	resolveAgentToken.mockReset()
	claimPendingCommands.mockReset()
})

describe('GET /api/agent/commands', () => {
	it('401s without a token', async () => {
		const res = await GET(req(undefined) as never)
		expect(res.status).toBe(401)
	})

	it('401s on an invalid token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		const res = await GET(req('Bearer x') as never)
		expect(res.status).toBe(401)
	})

	it('returns claimed commands flattened for the agent', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([
			{ id: 'c1', type: 'power', payload: { action: 'reboot' }, status: 'claimed' },
			{ id: 'c2', type: 'conf', payload: null, status: 'claimed' },
		])
		const res = await GET(req('Bearer x') as never)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(claimPendingCommands).toHaveBeenCalledWith({}, 'rb1')
		expect(body.commands).toEqual([
			{ id: 'c1', type: 'power', payload: { action: 'reboot' } },
			{ id: 'c2', type: 'conf', payload: {} },
		])
	})
})
