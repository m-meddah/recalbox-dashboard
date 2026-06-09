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
vi.mock('@/lib/config-store', () => ({
	configStore: {
		getRecalbox: () => ({ id: 'rb-1', name: 'A', sshPassword: 'x' }),
		getRecalboxes: () => [{ id: 'rb-1', archived: false }],
		updateRecalboxConfig: vi.fn(),
		removeRecalbox: vi.fn(),
	},
}))

import { DELETE, GET } from '../route'

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
