import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()
const enqueueCommand = vi.fn()
const listCommands = vi.fn()

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
	configStore: { getRecalbox: () => ({ id: 'rb-1', name: 'A' }) },
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-commands', () => ({
	enqueueCommand: (...a: unknown[]) => enqueueCommand(...a),
	listCommands: (...a: unknown[]) => listCommands(...a),
}))

import { GET, POST } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }

afterEach(() => {
	getUser.mockReset()
	canView.mockReset()
	canControl.mockReset()
	enqueueCommand.mockReset()
	listCommands.mockReset()
})

describe('GET /api/recalboxes/[id]/commands', () => {
	it('401s when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		const res = await GET({} as never, ctx as never)
		expect(res.status).toBe(401)
	})

	it('404s when the user cannot view the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canView.mockReturnValue(false)
		const res = await GET({} as never, ctx as never)
		expect(res.status).toBe(404)
	})

	it('lists the commands', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canView.mockReturnValue(true)
		listCommands.mockResolvedValue([{ id: 'c1', type: 'power' }])
		const res = await GET({} as never, ctx as never)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.commands).toHaveLength(1)
	})
})

describe('POST /api/recalboxes/[id]/commands', () => {
	function req(body: unknown) {
		return { json: async () => body }
	}

	it('403s when the user cannot control the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockReturnValue(false)
		const res = await POST(req({ type: 'power', action: 'reboot' }) as never, ctx as never)
		expect(res.status).toBe(403)
	})

	it('400s on a command that fails the allowlist', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockReturnValue(true)
		const res = await POST(req({ type: 'power', action: 'selfdestruct' }) as never, ctx as never)
		expect(res.status).toBe(400)
		expect(enqueueCommand).not.toHaveBeenCalled()
	})

	it('enqueues a valid command split into type + payload', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockReturnValue(true)
		enqueueCommand.mockResolvedValue({ id: 'c1', type: 'conf', status: 'pending' })
		const res = await POST(req({ type: 'conf', key: 'audio.volume', value: '90' }) as never, ctx as never)
		expect(res.status).toBe(201)
		expect(enqueueCommand).toHaveBeenCalledWith(
			{},
			'rb-1',
			'conf',
			{ key: 'audio.volume', value: '90' },
			'm1',
		)
	})
})
