import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-user', () => ({
	getUser: vi.fn(),
	unauthorized: () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
	forbidden: () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
}))
vi.mock('@/lib/auth/invitations', async (orig) => ({
	...(await orig<typeof import('@/lib/auth/invitations')>()),
	createInvitation: vi.fn(() => ({ invitation: { expiresAt: 123 }, token: 'raw-token' })),
	acceptInvitation: vi.fn(),
	validateInvitation: vi.fn(),
}))
vi.mock('@/lib/db/invitation-queries', async (orig) => ({
	...(await orig<typeof import('@/lib/db/invitation-queries')>()),
	listPendingInvitations: vi.fn(() => []),
}))

import { acceptInvitation, validateInvitation } from '@/lib/auth/invitations'
import { getUser } from '@/lib/auth/require-user'
import type { NextRequest } from 'next/server'
import { POST as acceptRoute } from '../accept/route'
import { POST as createInvite, GET as listInvites } from '../route'
import { GET as validateRoute } from '../validate/route'

const asReq = (r: Request) => r as unknown as NextRequest
const asMock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('POST /api/invitations', () => {
	it('401 when unauthenticated', async () => {
		asMock(getUser).mockResolvedValue(null)
		const res = await createInvite(
			asReq(new Request('http://x/api/invitations', { method: 'POST', body: '{}' })),
		)
		expect(res.status).toBe(401)
	})

	it('403 when not admin', async () => {
		asMock(getUser).mockResolvedValue({ id: 'u1', email: 'm@x.c', role: 'member' })
		const res = await createInvite(
			asReq(
				new Request('http://x/api/invitations', {
					method: 'POST',
					body: JSON.stringify({ email: 'k@x.co' }),
				}),
			),
		)
		expect(res.status).toBe(403)
	})

	it('returns a link for an admin', async () => {
		asMock(getUser).mockResolvedValue({ id: 'a1', email: 'a@x.c', role: 'admin' })
		const res = await createInvite(
			asReq(
				new Request('http://x/api/invitations', {
					method: 'POST',
					body: JSON.stringify({ email: 'k@x.co' }),
				}),
			),
		)
		expect(res.status).toBe(200)
		const json = await res.json()
		expect(json.link).toContain('/accept-invite?token=raw-token')
		expect(json.email).toBe('k@x.co')
	})
})

describe('GET /api/invitations', () => {
	it('403 when not admin', async () => {
		asMock(getUser).mockResolvedValue({ id: 'u1', email: 'm@x.c', role: 'member' })
		const res = await listInvites()
		expect(res.status).toBe(403)
	})
})

describe('GET /api/invitations/validate', () => {
	it('reports invalid when token does not validate', async () => {
		asMock(validateInvitation).mockReturnValue(null)
		const res = await validateRoute(
			asReq(new Request('http://x/api/invitations/validate?token=bad')),
		)
		expect(await res.json()).toEqual({ valid: false })
	})

	it('echoes the email for a valid token', async () => {
		asMock(validateInvitation).mockReturnValue({ email: 'k@x.co' })
		const res = await validateRoute(
			asReq(new Request('http://x/api/invitations/validate?token=ok')),
		)
		expect(await res.json()).toEqual({ valid: true, email: 'k@x.co' })
	})
})

describe('POST /api/invitations/accept', () => {
	it('400 on a short password (no accept attempted)', async () => {
		const res = await acceptRoute(
			asReq(
				new Request('http://x/api/invitations/accept', {
					method: 'POST',
					body: JSON.stringify({ token: 'ok', password: 'short' }),
				}),
			),
		)
		expect(res.status).toBe(400)
		expect(acceptInvitation).not.toHaveBeenCalled()
	})

	it('returns ok on success', async () => {
		asMock(acceptInvitation).mockResolvedValue({ email: 'k@x.co' })
		const res = await acceptRoute(
			asReq(
				new Request('http://x/api/invitations/accept', {
					method: 'POST',
					body: JSON.stringify({ token: 'ok', password: 'longenough' }),
				}),
			),
		)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ ok: true, email: 'k@x.co' })
	})
})
