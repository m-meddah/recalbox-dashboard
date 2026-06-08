import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: (...a: unknown[]) => getUser(...a),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
	}
})
vi.mock('@/lib/config-store', () => ({ configStore: { getRecalboxes: () => [] } }))

import { GET } from '../route'

afterEach(() => getUser.mockReset())

describe('GET /api/recalboxes', () => {
	it('returns 401 when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		const res = await GET()
		expect(res.status).toBe(401)
	})

	it('returns 200 when authenticated', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'member' })
		const res = await GET()
		expect(res.status).toBe(200)
	})
})
