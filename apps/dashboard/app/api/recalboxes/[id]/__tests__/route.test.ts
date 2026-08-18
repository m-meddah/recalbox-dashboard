import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()

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
const updateRecalboxConfig = vi.fn()
vi.mock('@/lib/config-store', () => ({
	configStore: {
		getRecalbox: () => ({ id: 'rb-1', name: 'A', sshPassword: 'x' }),
		getRecalboxes: () => [{ id: 'rb-1', archived: false }],
		updateRecalboxConfig: (...a: unknown[]) => updateRecalboxConfig(...a),
		removeRecalbox: vi.fn(),
	},
}))

import { DELETE, GET, PUT } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }
afterEach(() => {
	getUser.mockReset()
	canView.mockReset()
	canControl.mockReset()
})

describe('GET /api/recalboxes/[id]', () => {
	it('404s when the user cannot view it', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canView.mockReturnValue(false)
		const res = await GET({} as never, ctx as never)
		expect(res.status).toBe(404)
	})

	it('returns the recalbox when the user can view it', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canView.mockReturnValue(true)
		const res = await GET({} as never, ctx as never)
		expect(res.status).toBe(200)
	})
})

describe('DELETE /api/recalboxes/[id]', () => {
	it('403s when the user cannot control it', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canControl.mockReturnValue(false)
		const res = await DELETE({} as never, ctx as never)
		expect(res.status).toBe(403)
	})
})

describe('PUT /api/recalboxes/[id]', () => {
	const put = (body: unknown) =>
		PUT(
			new Request('http://localhost/api/recalboxes/rb-1', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				// biome-ignore lint/suspicious/noExplicitAny: NextRequest shape not needed here
			}) as any,
			ctx as never,
		)

	afterEach(() => updateRecalboxConfig.mockReset())

	it('saves an edit that leaves the password field blank', async () => {
		// The edit page always sends sshPassword:'' — it never receives the stored secret
		// back to prefill. Rejecting the blank made every save fail, even a rename.
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canControl.mockReturnValue(true)
		const res = await put({ name: 'Salon', sshPassword: '' })
		expect(res.status).toBe(200)
	})

	it('keeps the stored password when the field is blank', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canControl.mockReturnValue(true)
		await put({ name: 'Salon', sshPassword: '' })
		// undefined, not absent: the store skips undefined keys, so the stored secret stands.
		expect(updateRecalboxConfig.mock.calls[0]?.[1].sshPassword).toBeUndefined()
	})

	it('writes a password the user actually typed', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canControl.mockReturnValue(true)
		await put({ sshPassword: 'recalboxroot' })
		expect(updateRecalboxConfig.mock.calls[0]?.[1]).toMatchObject({ sshPassword: 'recalboxroot' })
	})
})
