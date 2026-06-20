import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()
const listAgentTokens = vi.fn()
const createAgentToken = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canViewRecalbox: (...a: unknown[]) => canView(...a),
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
}))
vi.mock('@/lib/config-store', () => ({
	configStore: { getRecalbox: () => ({ id: 'rb-1', name: 'A' }) },
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	listAgentTokens: (...a: unknown[]) => listAgentTokens(...a),
	createAgentToken: (...a: unknown[]) => createAgentToken(...a),
}))

import { GET, POST } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }

afterEach(() => {
	getUser.mockReset()
	canView.mockReset()
	canControl.mockReset()
	listAgentTokens.mockReset()
	createAgentToken.mockReset()
})

describe('GET /api/recalboxes/[id]/agent-tokens', () => {
	it('404s when the user cannot view the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canView.mockReturnValue(false)
		const res = await GET({} as never, ctx as never)
		expect(res.status).toBe(404)
	})

	it('returns active tokens without exposing the hash', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canView.mockReturnValue(true)
		listAgentTokens.mockResolvedValue([
			{ id: 't1', name: 'a', tokenHash: 'SECRETHASH', createdAt: new Date(), lastUsedAt: null, revokedAt: null },
			{ id: 't2', name: 'b', tokenHash: 'SECRETHASH2', createdAt: new Date(), lastUsedAt: null, revokedAt: new Date() },
		])
		const res = await GET({} as never, ctx as never)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.tokens).toHaveLength(1) // revoked one filtered out
		expect(body.tokens[0].id).toBe('t1')
		expect(JSON.stringify(body)).not.toContain('SECRETHASH')
	})
})

describe('POST /api/recalboxes/[id]/agent-tokens', () => {
	function req(body: unknown) {
		return { json: async () => body, url: 'http://localhost:3000/api/recalboxes/rb-1/agent-tokens' }
	}

	it('403s when the user cannot control the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockReturnValue(false)
		const res = await POST(req({}) as never, ctx as never)
		expect(res.status).toBe(403)
	})

	it('mints a token and returns the raw value + ingest URL once', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockReturnValue(true)
		createAgentToken.mockResolvedValue({
			token: 'sra_demo',
			row: { id: 't1', name: 'a', createdAt: new Date() },
		})
		const res = await POST(req({ name: 'a' }) as never, ctx as never)
		expect(res.status).toBe(201)
		const body = await res.json()
		expect(body.token).toBe('sra_demo')
		expect(body.ingestUrl).toContain('/api/agent/ingest')
		expect(createAgentToken).toHaveBeenCalledWith({}, 'rb-1', 'a')
	})
})
