import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const claimPendingCommands = vi.fn()
const readAgentChannel = vi.fn()
const readRolloutSettings = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/db/agent-commands', () => ({
	claimPendingCommands: (...a: unknown[]) => claimPendingCommands(...a),
}))
vi.mock('@/lib/db/agent-rollout-queries', () => ({
	readAgentChannel: (...a: unknown[]) => readAgentChannel(...a),
}))
vi.mock('@/lib/agent/rollout-settings', () => ({
	readRolloutSettings: () => readRolloutSettings(),
}))

import { GET } from '../route'

function req(auth: string | undefined, version?: string) {
	return {
		headers: {
			get: (k: string) => {
				const key = k.toLowerCase()
				if (key === 'authorization') return auth ?? null
				if (key === 'x-agent-version') return version ?? null
				return null
			},
		},
	}
}

afterEach(() => {
	resolveAgentToken.mockReset()
	claimPendingCommands.mockReset()
	readAgentChannel.mockReset()
	readRolloutSettings.mockReset()
})

describe('GET /api/agent/commands', () => {
	it('401s without a token', async () => {
		const res = await GET(req(undefined) as never)
		expect(res.status).toBe(401)
	})

	it('401s on an invalid token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		const res = await GET(req('Bearer x') as never)
		expect(res.status).toBe(401)
	})

	it('returns claimed commands flattened for the agent', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([
			{ id: 'c1', type: 'power', payload: { action: 'reboot' }, status: 'claimed' },
			{ id: 'c2', type: 'conf', payload: null, status: 'claimed' },
		])
		readAgentChannel.mockResolvedValue('stable')
		readRolloutSettings.mockResolvedValue({ targetVersion: '1.0.0', rolloutPercent: 0 })
		const res = await GET(req('Bearer x') as never)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(claimPendingCommands).toHaveBeenCalledWith({}, 'rb1')
		expect(body.commands).toEqual([
			{ id: 'c1', type: 'power', payload: { action: 'reboot' } },
			{ id: 'c2', type: 'conf', payload: {} },
		])
	})
})

describe('GET /api/agent/commands — target version', () => {
	it('announces the target to a stable box inside the batch', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([])
		readAgentChannel.mockResolvedValue('stable')
		readRolloutSettings.mockResolvedValue({ targetVersion: '1.1.0', rolloutPercent: 100 })
		const res = await GET(req('Bearer x', '1.0.0') as never)
		const body = await res.json()
		expect(body.agent).toEqual({ target_version: '1.1.0' })
	})

	it('says nothing to a stable box outside the batch', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([])
		readAgentChannel.mockResolvedValue('stable')
		readRolloutSettings.mockResolvedValue({ targetVersion: '1.1.0', rolloutPercent: 0 })
		const res = await GET(req('Bearer x', '1.0.0') as never)
		const body = await res.json()
		expect(body.agent).toEqual({ target_version: null })
	})

	it('says nothing to an agent that never declared its version', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([])
		readAgentChannel.mockResolvedValue('stable')
		readRolloutSettings.mockResolvedValue({ targetVersion: '1.1.0', rolloutPercent: 100 })
		const res = await GET(req('Bearer x') as never)
		const body = await res.json()
		expect(body.agent).toEqual({ target_version: null })
	})

	it('still serves commands when the rollout lookup fails', async () => {
		// A box must keep receiving power/conf commands even if the rollout
		// machinery is broken: control is the older, more important promise.
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([{ id: 'c1', type: 'power', payload: {} }])
		readAgentChannel.mockRejectedValue(new Error('db down'))
		readRolloutSettings.mockResolvedValue({ targetVersion: '1.1.0', rolloutPercent: 100 })
		const res = await GET(req('Bearer x', '1.0.0') as never)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.commands).toHaveLength(1)
		expect(body.agent).toEqual({ target_version: null })
	})
})
