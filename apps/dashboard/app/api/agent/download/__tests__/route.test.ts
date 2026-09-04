import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const readAgentPayload = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/agent/payload', () => ({
	readAgentPayload: () => readAgentPayload(),
}))

import { GET } from '../route'

function req(auth: string | undefined) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (auth ?? null) : null) },
	}
}

afterEach(() => {
	resolveAgentToken.mockReset()
	readAgentPayload.mockReset()
})

describe('GET /api/agent/download', () => {
	it('401s without a token', async () => {
		expect((await GET(req(undefined) as never)).status).toBe(401)
	})

	it('401s on an invalid token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		expect((await GET(req('Bearer x') as never)).status).toBe(401)
	})

	it('serves the deployed bundle to a valid token', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		readAgentPayload.mockResolvedValue({
			agentPy: '# agent',
			scanRomsPy: '# scan',
			launchPy: '# launch',
			updaterPy: '# updater',
			launcherSh: '# sh',
			version: '1.1.0',
		})
		const res = await GET(req('Bearer x') as never)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.version).toBe('1.1.0')
		expect(Object.keys(body.files).sort()).toEqual([
			'VERSION',
			'agent.py',
			'launch.py',
			'scan_roms.py',
			'updater.py',
		])
		// The launcher is deliberately absent: it is the one file whose
		// corruption is unrecoverable, so it is never auto-updated.
		expect(body.files['sr-agent[systembrowsing].sh']).toBeUndefined()
		expect(body.files.VERSION).toBe('1.1.0\n')
	})

	it('never lets a bundle be cached', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		readAgentPayload.mockResolvedValue({
			agentPy: '',
			scanRomsPy: '',
			launchPy: '',
			updaterPy: '',
			launcherSh: '',
			version: '1.1.0',
		})
		const res = await GET(req('Bearer x') as never)
		expect(res.headers.get('cache-control')).toContain('no-store')
	})

	it('500s rather than serving half a bundle', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		readAgentPayload.mockRejectedValue(new Error('ENOENT'))
		expect((await GET(req('Bearer x') as never)).status).toBe(500)
	})
})
