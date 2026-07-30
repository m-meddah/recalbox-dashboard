import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()
const getLatestScan = vi.fn()
const listSystemAudits = vi.fn()
const createScan = vi.fn()
const enqueueCommand = vi.fn()
const startSelfHostedScan = vi.fn()
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
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/rom-audit-queries', async () => {
	const actual = await vi.importActual<typeof import('@/lib/db/rom-audit-queries')>(
		'@/lib/db/rom-audit-queries',
	)
	return {
		isScanStale: actual.isScanStale,
		SCAN_STALE_MS: actual.SCAN_STALE_MS,
		getLatestScan: (...a: unknown[]) => getLatestScan(...a),
		listSystemAudits: (...a: unknown[]) => listSystemAudits(...a),
		createScan: (...a: unknown[]) => createScan(...a),
	}
})
vi.mock('@/lib/db/agent-commands', () => ({
	enqueueCommand: (...a: unknown[]) => enqueueCommand(...a),
}))
vi.mock('@/lib/rom-audit/scan-service', () => ({
	startSelfHostedScan: (...a: unknown[]) => startSelfHostedScan(...a),
}))
vi.mock('@/lib/serverless', () => ({ isServerlessMode: () => serverless() }))

import { GET, POST } from '../route'

function post(body: unknown) {
	return { json: async () => body } as never
}

function get(url: string) {
	return { url } as never
}

afterEach(() => {
	for (const m of [
		getUser,
		canView,
		canControl,
		getLatestScan,
		listSystemAudits,
		createScan,
		enqueueCommand,
		startSelfHostedScan,
		serverless,
	]) {
		m.mockReset()
	}
	serverless.mockReturnValue(false)
})

describe('POST /api/rom-audit/scan', () => {
	it('401s when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		expect((await POST(post({ recalboxId: 'rb-1' }))).status).toBe(401)
	})

	it('403s when the user cannot control the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockResolvedValue(false)
		expect((await POST(post({ recalboxId: 'rb-1' }))).status).toBe(403)
	})

	// A system id is a directory name; anything path-shaped is a red flag.
	it('400s on a system id carrying a path separator', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockResolvedValue(true)
		const res = await POST(post({ recalboxId: 'rb-1', systems: ['../etc'] }))
		expect(res.status).toBe(400)
		expect(startSelfHostedScan).not.toHaveBeenCalled()
	})

	it('starts a self-hosted scan and answers 202', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockResolvedValue(true)
		getLatestScan.mockResolvedValue(null)
		startSelfHostedScan.mockResolvedValue({ status: 'started', scanId: 's1', systemsTotal: 3 })
		const res = await POST(post({ recalboxId: 'rb-1' }))
		expect(res.status).toBe(202)
		expect(await res.json()).toMatchObject({ scanId: 's1', transport: 'ssh' })
	})

	it('refuses to start a second scan while one runs', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockResolvedValue(true)
		getLatestScan.mockResolvedValue({ id: 's1', status: 'running', updatedAt: new Date() })
		const res = await POST(post({ recalboxId: 'rb-1' }))
		expect(res.status).toBe(409)
		expect(await res.json()).toMatchObject({ scanId: 's1' })
		expect(startSelfHostedScan).not.toHaveBeenCalled()
	})

	// A server killed mid-scan leaves a 'running' row nobody will close; it must
	// not lock the feature out for good.
	it('starts anyway when the running scan is stale', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockResolvedValue(true)
		getLatestScan.mockResolvedValue({
			id: 's1',
			status: 'running',
			updatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
		})
		startSelfHostedScan.mockResolvedValue({ status: 'started', scanId: 's2', systemsTotal: 1 })
		expect((await POST(post({ recalboxId: 'rb-1' }))).status).toBe(202)
	})

	it('422s when the box exposes no scannable directory', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockResolvedValue(true)
		getLatestScan.mockResolvedValue(null)
		startSelfHostedScan.mockResolvedValue({ status: 'no-targets' })
		expect((await POST(post({ recalboxId: 'rb-1' }))).status).toBe(422)
	})

	it('queues an agent command in serverless mode instead of driving ssh', async () => {
		serverless.mockReturnValue(true)
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockResolvedValue(true)
		getLatestScan.mockResolvedValue(null)
		createScan.mockResolvedValue({ id: 's9' })

		const res = await POST(post({ recalboxId: 'rb-1', systems: ['snes'] }))
		expect(res.status).toBe(202)
		expect(await res.json()).toMatchObject({ scanId: 's9', transport: 'agent' })
		expect(startSelfHostedScan).not.toHaveBeenCalled()
		expect(enqueueCommand).toHaveBeenCalledWith(
			{},
			'rb-1',
			'scan',
			{ scanId: 's9', systems: ['snes'] },
			'm1',
		)
	})

	it('500s without crashing when starting the scan throws', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockResolvedValue(true)
		getLatestScan.mockResolvedValue(null)
		startSelfHostedScan.mockRejectedValue(new Error('ssh down'))
		expect((await POST(post({ recalboxId: 'rb-1' }))).status).toBe(500)
	})
})

describe('GET /api/rom-audit/scan', () => {
	it('401s when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		expect((await GET(get('http://x/api?recalboxId=rb-1'))).status).toBe(401)
	})

	it('404s when the user cannot view the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canView.mockResolvedValue(false)
		expect((await GET(get('http://x/api?recalboxId=rb-1'))).status).toBe(404)
	})

	it('returns the latest scan and the audited system count', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canView.mockResolvedValue(true)
		getLatestScan.mockResolvedValue({ id: 's1', status: 'done', updatedAt: new Date() })
		listSystemAudits.mockResolvedValue([{ system: 'snes' }, { system: 'nes' }])
		const body = await (await GET(get('http://x/api?recalboxId=rb-1'))).json()
		expect(body.scan.id).toBe('s1')
		expect(body.systems).toBe(2)
	})

	// The row is reported as failed, but never rewritten: reading is not writing.
	it('reports a stale scan as failed without touching the row', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canView.mockResolvedValue(true)
		getLatestScan.mockResolvedValue({
			id: 's1',
			status: 'running',
			error: null,
			updatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
		})
		listSystemAudits.mockResolvedValue([])
		const body = await (await GET(get('http://x/api?recalboxId=rb-1'))).json()
		expect(body.scan.status).toBe('failed')
		expect(body.scan.error).toBe('interrupted')
	})
})

// Found by running the dev server against a box whose stored SSH password was
// empty: discovery returned nothing and the route answered "no scannable
// directory", which points the reader at their collection instead of at the
// connection.
describe('POST /api/rom-audit/scan (box unreachable)', () => {
	it('502s with the connection error rather than claiming there is nothing to scan', async () => {
		getUser.mockResolvedValue({ id: 'm1', role: 'member' })
		canControl.mockResolvedValue(true)
		getLatestScan.mockResolvedValue(null)
		startSelfHostedScan.mockResolvedValue({
			status: 'unreachable',
			reason: 'All configured authentication methods failed',
		})
		const res = await POST(post({ recalboxId: 'rb-1' }))
		expect(res.status).toBe(502)
		const body = await res.json()
		expect(body.error).toBe('box_unreachable')
		expect(body.detail).toContain('authentication')
	})
})
