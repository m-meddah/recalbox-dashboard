import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
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
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
}))
vi.mock('@/lib/config-store', () => ({
	configStore: { getRecalbox: () => ({ id: 'rb-1', name: 'Salon' }) },
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	createAgentToken: async () => ({ token: 'raw-token', row: { id: 'tok-1', name: 'installeur' } }),
}))
vi.mock('@/lib/agent/payload', () => ({
	readAgentPayload: async () => ({
		agentPy: '# agent',
		scanRomsPy: '# scan',
		launchPy: '# launch',
		launcherSh: '#!/bin/bash\n',
		version: '1.0.0',
	}),
}))

import { GET } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }
const req = () => new Request('http://localhost/api/recalboxes/rb-1/installer') as never

beforeEach(() => {
	getUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'member' })
	canControl.mockResolvedValue(true)
})
afterEach(() => {
	getUser.mockReset()
	canControl.mockReset()
})

describe('GET /api/recalboxes/[id]/installer', () => {
	it('401 sans session', async () => {
		getUser.mockResolvedValue(null)
		expect((await GET(req(), ctx as never)).status).toBe(401)
	})

	it('403 pour qui ne contrôle pas la box', async () => {
		canControl.mockResolvedValue(false)
		expect((await GET(req(), ctx as never)).status).toBe(403)
	})

	it('renvoie une archive zip nommée', async () => {
		const res = await GET(req(), ctx as never)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('application/zip')
		expect(res.headers.get('content-disposition')).toContain('.zip')
	})

	it('produit un zip qui contient le token frappé', async () => {
		const { unzipSync, strFromU8 } = await import('fflate')
		const res = await GET(req(), ctx as never)
		const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
		const config = JSON.parse(strFromU8(files['system/sr-agent/config.json']))
		expect(config.token).toBe('raw-token')
	})
})
