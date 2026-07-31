import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const reset = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	isAdmin: (u: { role: string }) => u.role === 'admin',
}))
vi.mock('@/lib/config-store', () => ({
	configStore: {
		reset: (...a: unknown[]) => {
			reset(...a)
			return Promise.resolve({ recalbox: {}, retroachievements: {}, superRetrogamers: {} })
		},
	},
}))

import { POST } from '../route'

function req(body: unknown): Request {
	return new Request('http://x/api/settings/reset', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

afterEach(() => {
	getUser.mockReset()
	reset.mockReset()
})

describe('POST /api/settings/reset', () => {
	it('returns 401 when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		const res = await POST(req({}) as never)
		expect(res.status).toBe(401)
	})

	it('refuses a member wiping every scope (omitted scope resets ALL settings)', async () => {
		getUser.mockResolvedValue({ id: 'mallory', email: 'm@b.c', role: 'member' })

		const res = await POST(req({}) as never)

		expect(res.status).toBe(403)
		expect(reset).not.toHaveBeenCalled()
	})

	it('refuses a member resetting a single scope', async () => {
		getUser.mockResolvedValue({ id: 'mallory', email: 'm@b.c', role: 'member' })

		const res = await POST(req({ scope: 'scrobble' }) as never)

		expect(res.status).toBe(403)
		expect(reset).not.toHaveBeenCalled()
	})

	it('lets an admin reset', async () => {
		getUser.mockResolvedValue({ id: 'admin1', email: 'a@b.c', role: 'admin' })

		const res = await POST(req({ scope: 'scrobble' }) as never)

		expect(res.status).toBe(200)
		expect(reset).toHaveBeenCalledWith('scrobble')
	})
})
