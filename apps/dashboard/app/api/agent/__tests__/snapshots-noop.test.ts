import { describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const ingestSnapshot = vi.fn()

vi.mock('@/lib/serverless', () => ({ isServerlessMode: () => true }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/agent/ingest-snapshot', () => ({
	ingestSnapshot: (...a: unknown[]) => ingestSnapshot(...a),
}))

import { POST } from '../snapshots/route'

const body = {
	captured_at: new Date().toISOString(),
	cpu_percent: 12,
	mem_used_mb: 300,
	mem_total_mb: 1000,
	temp_celsius: 45,
	uptime_seconds: 3600,
}

const post = () =>
	POST(
		new Request('http://x/api/agent/snapshots', {
			method: 'POST',
			headers: { authorization: 'Bearer t0ken', 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}) as never,
	)

describe('POST /api/agent/snapshots en mode serverless', () => {
	it('accepte la requête sans rien écrire', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb-1' })
		const res = await post()
		expect(res.status).toBe(204)
		expect(ingestSnapshot).not.toHaveBeenCalled()
	})

	// lastUsedAt est le signal de vivacité lu par buildSeedState : le token doit être
	// résolu même si la charge utile est jetée, sinon toutes les box passent hors ligne.
	it('résout quand même le token', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb-1' })
		await post()
		expect(resolveAgentToken).toHaveBeenCalled()
	})

	it('refuse toujours un token invalide', async () => {
		resolveAgentToken.mockResolvedValue(null)
		const res = await post()
		expect(res.status).toBe(401)
	})
})
