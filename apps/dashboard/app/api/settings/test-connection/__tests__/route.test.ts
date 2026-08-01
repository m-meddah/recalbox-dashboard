import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canControl = vi.fn()
const activeId = vi.fn()
const loadRecalbox = vi.fn()
const sshConnect = vi.fn()

/**
 * Fixture passwords. Named constants rather than inline literals, and prefixed so
 * they read as placeholders to a human AND to secret scanners — a short arbitrary
 * string next to a password-ish key was enough to raise a GitGuardian "generic
 * password" incident on this file.
 */
const PW_STORED = 'not-a-real-password-stored-scope'
const PW_OWNED = 'not-a-real-password-owned-box'
const PW_TYPED = 'not-a-real-password-typed-in-wizard'
const PW_CALLER = 'not-a-real-password-supplied-by-caller'

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
}))
vi.mock('@/lib/auth/recalbox-acl', () => ({
	loadRecalbox: (...a: unknown[]) => loadRecalbox(...a),
}))
vi.mock('@/lib/recalbox/active', () => ({
	getActiveRecalboxId: () => activeId(),
}))
vi.mock('@/lib/config-store', () => ({
	configStore: {
		get: () => ({
			recalbox: {
				host: 'stored-host',
				sshUser: 'root',
				sshPassword: PW_STORED,
				sshPort: 22,
				mqttPort: 1883,
			},
		}),
	},
}))
vi.mock('node-ssh', () => ({
	NodeSSH: class {
		connect = (...a: unknown[]) => {
			sshConnect(...a)
			return Promise.resolve()
		}
		execCommand = vi.fn().mockResolvedValue({ stdout: 'ok' })
		dispose = vi.fn()
	},
}))
vi.mock('mqtt', () => ({
	default: {
		connect: () => ({
			on: (ev: string, cb: (...a: unknown[]) => void) => {
				if (ev === 'connect') setTimeout(() => cb(), 0)
			},
			subscribe: vi.fn(),
			end: vi.fn(),
		}),
	},
}))

import { POST } from '../route'

const OWNED_BOX = {
	id: 'rb-1',
	host: 'my-box.local',
	sshUser: 'root',
	sshPassword: PW_OWNED,
	sshPort: 22,
	mqttPort: 1883,
}

function req(body: unknown): Request {
	return new Request('http://x/api/settings/test-connection', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

async function runPost(body: unknown) {
	vi.useFakeTimers()
	const p = POST(req(body) as never)
	await vi.runAllTimersAsync()
	const res = await p
	vi.useRealTimers()
	return res
}

afterEach(() => {
	getUser.mockReset()
	canControl.mockReset()
	activeId.mockReset()
	loadRecalbox.mockReset()
	sshConnect.mockReset()
})

describe('POST /api/settings/test-connection', () => {
	it('returns 401 when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		const res = await POST(req({}) as never)
		expect(res.status).toBe(401)
	})

	it('never sends a stored password to a host chosen by a non-owner', async () => {
		getUser.mockResolvedValue({ id: 'mallory', email: 'm@b.c', role: 'member' })
		activeId.mockResolvedValue('rb-1')
		canControl.mockResolvedValue(false)

		const res = await POST(req({ host: 'attacker.tld', sshPort: 22 }) as never)

		expect(res.status).toBe(403)
		expect(sshConnect).not.toHaveBeenCalled()
	})

	it('denies an admin who does not own the box', async () => {
		getUser.mockResolvedValue({ id: 'admin1', email: 'a@b.c', role: 'admin' })
		activeId.mockResolvedValue('rb-1')
		canControl.mockResolvedValue(false)

		const res = await POST(req({ host: 'attacker.tld' }) as never)

		expect(res.status).toBe(403)
		expect(sshConnect).not.toHaveBeenCalled()
	})

	it('denies the stored-password path when no box is active', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'u@b.c', role: 'member' })
		activeId.mockResolvedValue(null)

		const res = await POST(req({ host: 'attacker.tld' }) as never)

		expect(res.status).toBe(403)
		expect(sshConnect).not.toHaveBeenCalled()
	})

	it('treats the mask sentinel as "use the stored password", not as a password', async () => {
		getUser.mockResolvedValue({ id: 'mallory', email: 'm@b.c', role: 'member' })
		activeId.mockResolvedValue('rb-1')
		canControl.mockResolvedValue(false)

		const res = await POST(req({ host: 'attacker.tld', sshPassword: '***' }) as never)

		expect(res.status).toBe(403)
		expect(sshConnect).not.toHaveBeenCalled()
	})

	it('lets the owner test without retyping the password', async () => {
		getUser.mockResolvedValue({ id: 'owner1', email: 'o@b.c', role: 'member' })
		activeId.mockResolvedValue('rb-1')
		canControl.mockResolvedValue(true)
		loadRecalbox.mockResolvedValue(OWNED_BOX)

		const res = await runPost({})

		expect(res.status).toBe(200)
		expect(await res.json()).toHaveProperty('overall')
		expect(sshConnect).toHaveBeenCalledWith(
			expect.objectContaining({ host: 'my-box.local', password: PW_OWNED }),
		)
	})

	it('lets the owner test a new host against their own stored password', async () => {
		getUser.mockResolvedValue({ id: 'owner1', email: 'o@b.c', role: 'member' })
		activeId.mockResolvedValue('rb-1')
		canControl.mockResolvedValue(true)
		loadRecalbox.mockResolvedValue(OWNED_BOX)

		const res = await runPost({ host: 'new-box.local' })

		expect(res.status).toBe(200)
		expect(sshConnect).toHaveBeenCalledWith(
			expect.objectContaining({ host: 'new-box.local', password: PW_OWNED }),
		)
	})

	it('allows the setup wizard: explicit credentials, no box owned yet', async () => {
		getUser.mockResolvedValue({ id: 'u1', email: 'u@b.c', role: 'member' })
		activeId.mockResolvedValue(null)
		canControl.mockResolvedValue(false)

		const res = await runPost({
			host: 'fresh-box.local',
			sshUser: 'root',
			sshPassword: PW_TYPED,
			sshPort: 22,
			mqttPort: 1883,
		})

		expect(res.status).toBe(200)
		expect(sshConnect).toHaveBeenCalledWith(
			expect.objectContaining({ host: 'fresh-box.local', password: PW_TYPED }),
		)
	})

	it('does not leak the stored password when explicit credentials are supplied', async () => {
		getUser.mockResolvedValue({ id: 'mallory', email: 'm@b.c', role: 'member' })
		activeId.mockResolvedValue('rb-1')
		canControl.mockResolvedValue(false)

		await runPost({ host: 'attacker.tld', sshPassword: PW_CALLER })

		const sent = sshConnect.mock.calls[0]?.[0] as { password: string } | undefined
		expect(sent?.password).toBe(PW_CALLER)
		expect(sent?.password).not.toBe(PW_STORED)
		expect(sent?.password).not.toBe(PW_OWNED)
	})
})
