import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getActiveRecalboxId = vi.fn()
const canControl = vi.fn()
const executeSystemPower = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/recalbox/active', () => ({ getActiveRecalboxId: () => getActiveRecalboxId() }))
vi.mock('@/lib/auth/ownership', () => ({
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
}))
vi.mock('@/lib/recalbox/ssh-client', () => ({ getSshClient: () => ({}) }))
vi.mock('@/lib/recalbox/system-power', () => ({
	executeSystemPower: (...a: unknown[]) => executeSystemPower(...a),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

import { POST } from '../route'

function req(body: unknown) {
	return new Request('http://x/api/system/power', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	}) as never
}

afterEach(() => {
	getUser.mockReset()
	getActiveRecalboxId.mockReset()
	canControl.mockReset()
	executeSystemPower.mockReset()
})

describe('POST /api/system/power', () => {
	it('403s when the user does not own the active recalbox', async () => {
		getUser.mockResolvedValue({ id: 'admin1', email: 'a@b.c', role: 'admin' })
		getActiveRecalboxId.mockResolvedValue('rb-2')
		canControl.mockReturnValue(false)
		const res = await POST(req({ action: 'reboot' }))
		expect(res.status).toBe(403)
		expect(executeSystemPower).not.toHaveBeenCalled()
	})

	it('proceeds when the user owns the active recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		executeSystemPower.mockResolvedValue(undefined)
		const res = await POST(req({ action: 'reboot' }))
		expect(res.status).toBe(200)
		expect(executeSystemPower).toHaveBeenCalled()
	})
})
