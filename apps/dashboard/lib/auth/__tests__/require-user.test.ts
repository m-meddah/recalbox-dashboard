import { afterEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn()

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth/server', () => ({
	auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } },
}))

import { UnauthorizedError, getUser, requireUser } from '../require-user'

afterEach(() => getSession.mockReset())

describe('getUser', () => {
	it('returns null when there is no session', async () => {
		getSession.mockResolvedValue(null)
		expect(await getUser()).toBeNull()
	})

	it('maps the session user with a default role of member', async () => {
		getSession.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c' } })
		expect(await getUser()).toEqual({ id: 'u1', email: 'a@b.c', role: 'member' })
	})

	it('preserves an explicit role', async () => {
		getSession.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c', role: 'admin' } })
		expect(await getUser()).toEqual({ id: 'u1', email: 'a@b.c', role: 'admin' })
	})
})

describe('requireUser', () => {
	it('throws UnauthorizedError when unauthenticated', async () => {
		getSession.mockResolvedValue(null)
		await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError)
	})

	it('returns the user when authenticated', async () => {
		getSession.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c', role: 'admin' } })
		expect(await requireUser()).toEqual({ id: 'u1', email: 'a@b.c', role: 'admin' })
	})
})
