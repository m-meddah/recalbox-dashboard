import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const ingestSnapshot = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/agent/ingest-snapshot', () => ({
	ingestSnapshot: (...a: unknown[]) => ingestSnapshot(...a),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { POST } from '../route'

function req(auth: string | undefined, body: unknown) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (auth ?? null) : null) },
		json: async () => body,
	}
}

afterEach(() => {
	resolveAgentToken.mockReset()
	ingestSnapshot.mockReset()
})

describe('POST /api/agent/snapshots', () => {
	it('401s without a token', async () => {
		const res = await POST(req(undefined, {}) as never)
		expect(res.status).toBe(401)
	})

	it('401s on an invalid token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		const res = await POST(req('Bearer x', {}) as never)
		expect(res.status).toBe(401)
	})

	it('201s and ingests a snapshot for the resolved Recalbox', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		ingestSnapshot.mockResolvedValue({ id: 5 })
		const res = await POST(
			req('Bearer sra_x', {
				captured_at: new Date().toISOString(),
				cpu_percent: 10,
				mem_used_mb: 100,
				mem_total_mb: 4096,
				temp_celsius: 45,
				uptime_seconds: 60,
			}) as never,
		)
		expect(res.status).toBe(201)
		const body = await res.json()
		expect(body.id).toBe(5)
		expect(ingestSnapshot).toHaveBeenCalledWith({}, 'rb1', expect.objectContaining({ cpuPercent: 10 }))
	})

	it('400s on an invalid payload', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		const res = await POST(req('Bearer sra_x', { captured_at: 'nope', cpu_percent: 'x' }) as never)
		expect(res.status).toBe(400)
	})
})
