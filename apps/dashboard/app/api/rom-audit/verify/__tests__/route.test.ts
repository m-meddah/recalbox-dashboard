import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()
const verifyEntry = vi.fn()
const availableTools = vi.fn()
const serverless = vi.fn()

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
vi.mock('@/lib/rom-audit/verify-service', () => ({
	verifyEntry: (...a: unknown[]) => verifyEntry(...a),
	availableTools: (...a: unknown[]) => availableTools(...a),
}))
vi.mock('@/lib/serverless', () => ({ isServerlessMode: () => serverless() }))

import { GET, POST } from '../route'

const post = (body: unknown) => ({ json: async () => body }) as never
const get = (url: string) => ({ url }) as never

afterEach(() => {
	for (const m of [getUser, canView, canControl, verifyEntry, availableTools, serverless]) {
		m.mockReset()
	}
	serverless.mockReturnValue(false)
})

function authed() {
	getUser.mockResolvedValue({ id: 'm1', role: 'member' })
	canControl.mockResolvedValue(true)
	canView.mockResolvedValue(true)
}

describe('POST /api/rom-audit/verify', () => {
	it('401s when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		expect((await POST(post({ recalboxId: 'rb-1', entryKey: '/a.chd' }))).status).toBe(401)
	})

	// It burns disk, bandwidth and CPU on the host: more than a read.
	it('403s when the user cannot control the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1' })
		canControl.mockResolvedValue(false)
		const res = await POST(post({ recalboxId: 'rb-1', entryKey: '/a.chd' }))
		expect(res.status).toBe(403)
		expect(verifyEntry).not.toHaveBeenCalled()
	})

	it('400s on a malformed body', async () => {
		authed()
		expect((await POST(post({ recalboxId: 'rb-1' }))).status).toBe(400)
	})

	// The cloud has neither the binaries nor the bandwidth for several GB.
	it('409s in serverless mode without touching the box', async () => {
		serverless.mockReturnValue(true)
		authed()
		const res = await POST(post({ recalboxId: 'rb-1', entryKey: '/a.chd' }))
		expect(res.status).toBe(409)
		expect(verifyEntry).not.toHaveBeenCalled()
	})

	it('returns the verdict of an intact chd', async () => {
		authed()
		verifyEntry.mockResolvedValue({ status: 'intact' })
		const res = await POST(post({ recalboxId: 'rb-1', entryKey: '/a.chd' }))
		expect(res.status).toBe(200)
		expect((await res.json()).result).toEqual({ status: 'intact' })
	})

	it('returns a corrupt verdict as a normal answer, not an error', async () => {
		authed()
		verifyEntry.mockResolvedValue({ status: 'corrupt', detail: 'Decompression error' })
		const res = await POST(post({ recalboxId: 'rb-1', entryKey: '/a.chd' }))
		expect(res.status).toBe(200)
		expect((await res.json()).result.status).toBe('corrupt')
	})

	// A stale row is a 404, not a failed verification — the two mean different
	// things to whoever reads the answer.
	it('404s when the entry no longer exists', async () => {
		authed()
		verifyEntry.mockResolvedValue({ status: 'failed', reason: 'entry not found' })
		expect((await POST(post({ recalboxId: 'rb-1', entryKey: '/gone.chd' }))).status).toBe(404)
	})

	it('reports a missing tool as a verdict, not as a server error', async () => {
		authed()
		verifyEntry.mockResolvedValue({ status: 'tool-missing', tool: 'chdman' })
		const res = await POST(post({ recalboxId: 'rb-1', entryKey: '/a.chd' }))
		expect(res.status).toBe(200)
		expect((await res.json()).result.tool).toBe('chdman')
	})

	it('500s without crashing when the service throws', async () => {
		authed()
		verifyEntry.mockRejectedValue(new Error('boom'))
		expect((await POST(post({ recalboxId: 'rb-1', entryKey: '/a.chd' }))).status).toBe(500)
	})
})

describe('GET /api/rom-audit/verify', () => {
	it('401s when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		expect((await GET(get('http://x/?recalboxId=rb-1'))).status).toBe(401)
	})

	it('404s when the user cannot view the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1' })
		canView.mockResolvedValue(false)
		expect((await GET(get('http://x/?recalboxId=rb-1'))).status).toBe(404)
	})

	it('reports which tools the host has', async () => {
		authed()
		availableTools.mockResolvedValue([
			{ tool: 'chdman', available: true, version: '0.285' },
			{ tool: 'dolphin-tool', available: false },
		])
		const body = await (await GET(get('http://x/?recalboxId=rb-1'))).json()
		expect(body.serverless).toBe(false)
		expect(body.tools).toHaveLength(2)
	})

	// No point probing binaries the cloud will never run.
	it('reports serverless without probing anything', async () => {
		serverless.mockReturnValue(true)
		authed()
		const body = await (await GET(get('http://x/?recalboxId=rb-1'))).json()
		expect(body.serverless).toBe(true)
		expect(body.tools).toEqual([])
		expect(availableTools).not.toHaveBeenCalled()
	})
})
