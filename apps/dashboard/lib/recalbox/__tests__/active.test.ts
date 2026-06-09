import { afterEach, describe, expect, it, vi } from 'vitest'

const getCookie = vi.fn()
const getUser = vi.fn()
const getViewableRecalboxIds = vi.fn()

vi.mock('next/headers', () => ({
	cookies: vi.fn(async () => ({ get: (n: string) => getCookie(n) })),
}))
vi.mock('@/lib/auth/require-user', () => ({ getUser: () => getUser() }))
vi.mock('@/lib/auth/ownership', () => ({ getViewableRecalboxIds: (u: unknown) => getViewableRecalboxIds(u) }))

import { getActiveRecalboxId } from '../active'

const user = { id: 'm1', email: 'm@b.c', role: 'member' }

afterEach(() => {
	getCookie.mockReset()
	getUser.mockReset()
	getViewableRecalboxIds.mockReset()
})

describe('getActiveRecalboxId', () => {
	it('returns null when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		expect(await getActiveRecalboxId()).toBeNull()
	})
	it('honours the cookie when it points to a viewable recalbox', async () => {
		getUser.mockResolvedValue(user)
		getCookie.mockReturnValue({ value: 'rb-1' })
		getViewableRecalboxIds.mockReturnValue(['rb-1', 'rb-2'])
		expect(await getActiveRecalboxId()).toBe('rb-1')
	})
	it('falls back to the first viewable when the cookie is not viewable', async () => {
		getUser.mockResolvedValue(user)
		getCookie.mockReturnValue({ value: 'rb-other' })
		getViewableRecalboxIds.mockReturnValue(['rb-2', 'rb-3'])
		expect(await getActiveRecalboxId()).toBe('rb-2')
	})
	it('returns null when the user has no viewable recalboxes', async () => {
		getUser.mockResolvedValue(user)
		getCookie.mockReturnValue(undefined)
		getViewableRecalboxIds.mockReturnValue([])
		expect(await getActiveRecalboxId()).toBeNull()
	})
})
