import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()
const listAgentTokens = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({ canViewRecalbox: (...a: unknown[]) => canView(...a) }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	listAgentTokens: (...a: unknown[]) => listAgentTokens(...a),
}))

import { GET } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }

beforeEach(() => {
	getUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'member' })
	canView.mockResolvedValue(true)
})
afterEach(() => {
	getUser.mockReset()
	canView.mockReset()
	listAgentTokens.mockReset()
})

describe('GET /api/recalboxes/[id]/agent-status', () => {
	it('seen=false tant qu aucun token n a servi', async () => {
		listAgentTokens.mockResolvedValue([{ id: 't1', lastUsedAt: null, revokedAt: null }])
		const body = await (await GET({} as never, ctx as never)).json()
		expect(body.seen).toBe(false)
		expect(body.lastSeenAt).toBeNull()
	})

	it('seen=true dès qu un token a servi', async () => {
		const when = new Date('2026-08-18T20:00:00Z')
		listAgentTokens.mockResolvedValue([{ id: 't1', lastUsedAt: when, revokedAt: null }])
		const body = await (await GET({} as never, ctx as never)).json()
		expect(body.seen).toBe(true)
		expect(body.lastSeenAt).toBe(when.toISOString())
	})

	it('ignore les tokens révoqués', async () => {
		listAgentTokens.mockResolvedValue([
			{ id: 't1', lastUsedAt: new Date(), revokedAt: new Date() },
		])
		expect((await (await GET({} as never, ctx as never)).json()).seen).toBe(false)
	})

	it('404 pour qui ne peut pas voir la box', async () => {
		canView.mockResolvedValue(false)
		expect((await GET({} as never, ctx as never)).status).toBe(404)
	})

	it('picks the latest timestamp from multiple tokens', async () => {
		const t1 = new Date('2026-08-18T10:00:00Z')
		const t2 = new Date('2026-08-18T20:00:00Z')
		const t3 = new Date('2026-08-18T15:00:00Z')
		listAgentTokens.mockResolvedValue([
			{ id: 'ta', lastUsedAt: t1, revokedAt: null },
			{ id: 'tb', lastUsedAt: t2, revokedAt: null },
			{ id: 'tc', lastUsedAt: t3, revokedAt: null },
		])
		const body = await (await GET({} as never, ctx as never)).json()
		expect(body.seen).toBe(true)
		expect(body.lastSeenAt).toBe(t2.toISOString())
	})

	it('ignores null lastUsedAt when comparing', async () => {
		const realDate = new Date('2026-08-19T12:00:00Z')
		listAgentTokens.mockResolvedValue([
			{ id: 't1', lastUsedAt: null, revokedAt: null },
			{ id: 't2', lastUsedAt: realDate, revokedAt: null },
			{ id: 't3', lastUsedAt: null, revokedAt: null },
		])
		const body = await (await GET({} as never, ctx as never)).json()
		expect(body.seen).toBe(true)
		expect(body.lastSeenAt).toBe(realDate.toISOString())
	})
})
