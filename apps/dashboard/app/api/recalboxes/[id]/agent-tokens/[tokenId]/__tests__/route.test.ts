import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canControl = vi.fn()
const listAgentTokens = vi.fn()
const revokeAgentToken = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	listAgentTokens: (...a: unknown[]) => listAgentTokens(...a),
	revokeAgentToken: (...a: unknown[]) => revokeAgentToken(...a),
}))

import { DELETE } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1', tokenId: 't1' }) }

afterEach(() => {
	getUser.mockReset()
	canControl.mockReset()
	listAgentTokens.mockReset()
	revokeAgentToken.mockReset()
})

describe('DELETE /api/recalboxes/[id]/agent-tokens/[tokenId]', () => {
	it('403s when the user cannot control the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockReturnValue(false)
		const res = await DELETE({} as never, ctx as never)
		expect(res.status).toBe(403)
		expect(revokeAgentToken).not.toHaveBeenCalled()
	})

	it('404s when the token does not belong to this Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockReturnValue(true)
		listAgentTokens.mockResolvedValue([{ id: 'other' }])
		const res = await DELETE({} as never, ctx as never)
		expect(res.status).toBe(404)
		expect(revokeAgentToken).not.toHaveBeenCalled()
	})

	it('revokes a token that belongs to the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockReturnValue(true)
		listAgentTokens.mockResolvedValue([{ id: 't1' }])
		const res = await DELETE({} as never, ctx as never)
		expect(res.status).toBe(200)
		expect(revokeAgentToken).toHaveBeenCalledWith({}, 't1')
	})
})
