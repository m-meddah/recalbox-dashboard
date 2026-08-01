import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const saveAndTest = vi.fn()

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
vi.mock('@/lib/igdb/auth', () => ({
	saveAndTestCredentials: (...a: unknown[]) => {
		saveAndTest(...a)
		return Promise.resolve({ ok: true })
	},
}))

import { POST } from '../route'

// Placeholder credentials, deliberately self-describing so secret scanners do not
// mistake them for a leaked IGDB app secret.
const CREDS = {
	clientId: 'not-a-real-igdb-client-id',
	clientSecret: 'not-a-real-igdb-client-secret',
}

function req(body: unknown): Request {
	return new Request('http://x/api/igdb/credentials', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

afterEach(() => {
	getUser.mockReset()
	saveAndTest.mockReset()
})

describe('POST /api/igdb/credentials', () => {
	it('returns 401 when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		const res = await POST(req(CREDS) as never)
		expect(res.status).toBe(401)
	})

	it('refuses a member overwriting the shared IGDB credentials', async () => {
		getUser.mockResolvedValue({ id: 'mallory', email: 'm@b.c', role: 'member' })

		const res = await POST(req(CREDS) as never)

		expect(res.status).toBe(403)
		expect(saveAndTest).not.toHaveBeenCalled()
	})

	it('lets an admin save credentials', async () => {
		getUser.mockResolvedValue({ id: 'admin1', email: 'a@b.c', role: 'admin' })

		const res = await POST(req(CREDS) as never)

		expect(res.status).toBe(200)
		expect(saveAndTest).toHaveBeenCalledWith(CREDS.clientId, CREDS.clientSecret)
	})
})
