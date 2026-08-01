import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canControl = vi.fn()
const activeId = vi.fn()
const updateRecalboxConfig = vi.fn()
const update = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
	// Real implementation — role semantics are what these tests are asserting.
	isAdmin: (u: { role: string }) => u.role === 'admin',
}))
vi.mock('@/lib/recalbox/active', () => ({
	getActiveRecalboxId: () => activeId(),
}))
vi.mock('@/lib/config-store', () => ({
	configStore: {
		get: () => ({ recalbox: {}, retroachievements: {}, superRetrogamers: {} }),
		update: (...a: unknown[]) => {
			update(...a)
			return Promise.resolve({ recalbox: {}, retroachievements: {}, superRetrogamers: {} })
		},
		updateRecalboxConfig: (...a: unknown[]) => {
			updateRecalboxConfig(...a)
			return Promise.resolve()
		},
	},
}))

import { PUT } from '../route'

function req(body: unknown): Request {
	return new Request('http://x/api/settings', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

afterEach(() => {
	getUser.mockReset()
	canControl.mockReset()
	activeId.mockReset()
	updateRecalboxConfig.mockReset()
	update.mockReset()
})

describe('PUT /api/settings', () => {
	it('returns 401 when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		const res = await PUT(req({ ui: { theme: 'dark' } }) as never)
		expect(res.status).toBe(401)
	})

	it('refuses to rewrite the connection details of a box the caller does not own', async () => {
		getUser.mockResolvedValue({ id: 'mallory', email: 'm@b.c', role: 'member' })
		activeId.mockResolvedValue('rb-1')
		canControl.mockResolvedValue(false)

		const res = await PUT(req({ recalbox: { host: 'attacker.tld' } }) as never)

		expect(res.status).toBe(403)
		expect(updateRecalboxConfig).not.toHaveBeenCalled()
	})

	it('refuses an admin who does not own the box', async () => {
		getUser.mockResolvedValue({ id: 'admin1', email: 'a@b.c', role: 'admin' })
		activeId.mockResolvedValue('rb-1')
		canControl.mockResolvedValue(false)

		const res = await PUT(req({ recalbox: { host: 'attacker.tld' } }) as never)

		expect(res.status).toBe(403)
		expect(updateRecalboxConfig).not.toHaveBeenCalled()
	})

	it('refuses when no box is active', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'u@b.c', role: 'member' })
		activeId.mockResolvedValue(null)

		const res = await PUT(req({ recalbox: { host: 'somewhere' } }) as never)

		expect(res.status).toBe(403)
		expect(updateRecalboxConfig).not.toHaveBeenCalled()
	})

	it('writes to the ACTIVE box when the caller owns it', async () => {
		getUser.mockResolvedValue({ id: 'owner1', email: 'o@b.c', role: 'member' })
		activeId.mockResolvedValue('rb-mine')
		canControl.mockResolvedValue(true)

		const res = await PUT(req({ recalbox: { host: 'my-box.local' } }) as never)

		expect(res.status).toBe(200)
		expect(updateRecalboxConfig).toHaveBeenCalledWith(
			'rb-mine',
			expect.objectContaining({ host: 'my-box.local' }),
		)
	})

	it('leaves non-recalbox scopes reachable without owning a box', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'u@b.c', role: 'member' })
		activeId.mockResolvedValue(null)

		const res = await PUT(req({ ui: { theme: 'dark' } }) as never)

		expect(res.status).toBe(200)
		expect(updateRecalboxConfig).not.toHaveBeenCalled()
		expect(update).toHaveBeenCalled()
	})

	it.each([
		['retroachievements', { retroachievements: { apiKey: 'not-a-real-api-key' } }],
		['superRetrogamers', { superRetrogamers: { apiUrl: 'http://attacker.tld' } }],
		['mqttPublish', { mqttPublish: { brokerUrl: 'mqtt://attacker.tld' } }],
		['scrobble', { scrobble: { minDurationSec: 0 } }],
	])('refuses a member writing the shared %s scope', async (_name, body) => {
		getUser.mockResolvedValue({ id: 'mallory', email: 'm@b.c', role: 'member' })

		const res = await PUT(req(body) as never)

		expect(res.status).toBe(403)
		expect(update).not.toHaveBeenCalled()
	})

	it('does not let a member repoint an API endpoint at a host they control', async () => {
		// The stored X-API-Key would be sent to that host on the next lookup — the same
		// exfiltration shape as the SSH password in test-connection.
		getUser.mockResolvedValue({ id: 'mallory', email: 'm@b.c', role: 'member' })

		const res = await PUT(
			req({ superRetrogamers: { apiUrl: 'http://attacker.tld', apiKey: '***' } }) as never,
		)

		expect(res.status).toBe(403)
		expect(update).not.toHaveBeenCalled()
	})

	it('lets an admin write the shared scopes', async () => {
		getUser.mockResolvedValue({ id: 'admin1', email: 'a@b.c', role: 'admin' })

		const res = await PUT(req({ retroachievements: { apiKey: 'not-a-real-api-key' } }) as never)

		expect(res.status).toBe(200)
		expect(update).toHaveBeenCalled()
	})

	it('leaves the ui scope open to members', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'u@b.c', role: 'member' })

		const res = await PUT(req({ ui: { theme: 'dark' } }) as never)

		expect(res.status).toBe(200)
		expect(update).toHaveBeenCalled()
	})

	it('ignores an empty shared scope rather than rejecting it', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'u@b.c', role: 'member' })

		const res = await PUT(req({ ui: { theme: 'dark' }, retroachievements: {} }) as never)

		expect(res.status).toBe(200)
	})

	it('does not overwrite the stored password when the mask sentinel is sent', async () => {
		getUser.mockResolvedValue({ id: 'owner1', email: 'o@b.c', role: 'member' })
		activeId.mockResolvedValue('rb-mine')
		canControl.mockResolvedValue(true)

		await PUT(req({ recalbox: { host: 'my-box.local', sshPassword: '***' } }) as never)

		const patch = updateRecalboxConfig.mock.calls[0]?.[1] as Record<string, unknown>
		expect(patch).not.toHaveProperty('sshPassword')
	})
})
