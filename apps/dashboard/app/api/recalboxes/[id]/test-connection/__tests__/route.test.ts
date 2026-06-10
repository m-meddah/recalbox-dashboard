import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canViewRecalbox: (...a: unknown[]) => canView(...a),
}))
vi.mock('@/lib/config-store', () => ({
	configStore: {
		getRecalbox: () => ({
			id: 'rb-1',
			host: 'h',
			sshUser: 'root',
			sshPassword: 'x',
			sshPort: 22,
			mqttPort: 1883,
		}),
	},
}))
vi.mock('node-ssh', () => ({
	NodeSSH: class {
		connect = vi.fn().mockResolvedValue(undefined)
		execCommand = vi.fn().mockResolvedValue({ stdout: 'ok' })
		dispose = vi.fn()
	},
}))
vi.mock('mqtt', () => ({
	default: {
		connect: () => {
			const client = {
				on: (ev: string, cb: (...a: unknown[]) => void) => {
					if (ev === 'connect') setTimeout(() => cb(), 0)
				},
				subscribe: vi.fn(),
				end: vi.fn(),
			}
			return client
		},
	},
}))

import { POST } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }
afterEach(() => {
	getUser.mockReset()
	canView.mockReset()
})

describe('POST /api/recalboxes/[id]/test-connection', () => {
	it('returns 401 when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		const res = await POST({} as never, ctx as never)
		expect(res.status).toBe(401)
	})

	it('returns 404 when the user cannot view the box', async () => {
		getUser.mockResolvedValue({ id: 'm1', email: 'm@b.c', role: 'member' })
		canView.mockReturnValue(false)
		const res = await POST({} as never, ctx as never)
		expect(res.status).toBe(404)
	})

	it('runs the diagnostic when the box is viewable', async () => {
		vi.useFakeTimers()
		getUser.mockResolvedValue({ id: 'a1', email: 'a@b.c', role: 'admin' })
		canView.mockReturnValue(true)
		const resPromise = POST({} as never, ctx as never)
		await vi.runAllTimersAsync()
		const res = await resPromise
		vi.useRealTimers()
		expect(res.status).toBe(200)
		expect(await res.json()).toHaveProperty('overall')
	})
})
