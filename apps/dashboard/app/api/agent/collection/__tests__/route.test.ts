import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const deriveSystemFromGamelistPath = vi.fn()
const parseSystemGames = vi.fn()
const upsertGames = vi.fn()
const importInheritedStatsFromGames = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/agent/ingest-collection', () => ({
	deriveSystemFromGamelistPath: (...a: unknown[]) => deriveSystemFromGamelistPath(...a),
	parseSystemGames: (...a: unknown[]) => parseSystemGames(...a),
}))
vi.mock('@/lib/db/queries', () => ({ upsertGames: (...a: unknown[]) => upsertGames(...a) }))
vi.mock('@/lib/recalbox/sync-inherited-stats', () => ({
	importInheritedStatsFromGames: (...a: unknown[]) => importInheritedStatsFromGames(...a),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { POST } from '../route'

function req(auth: string | undefined, body: unknown) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (auth ?? null) : null) },
		json: async () => body,
	}
}

const validBody = {
	gamelist_path: '/recalbox/share/externals/usb0/recalbox/roms/snes/gamelist.xml',
	gamelist_xml: '<gameList/>',
}

afterEach(() => {
	resolveAgentToken.mockReset()
	deriveSystemFromGamelistPath.mockReset()
	parseSystemGames.mockReset()
	upsertGames.mockReset()
	importInheritedStatsFromGames.mockReset()
})

describe('POST /api/agent/collection', () => {
	it('401s without a token', async () => {
		const res = await POST(req(undefined, validBody) as never)
		expect(res.status).toBe(401)
	})

	it('401s on an invalid token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		const res = await POST(req('Bearer x', validBody) as never)
		expect(res.status).toBe(401)
	})

	it('400s on an unrecognized gamelist path', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		deriveSystemFromGamelistPath.mockReturnValue(null)
		const res = await POST(req('Bearer x', validBody) as never)
		expect(res.status).toBe(400)
	})

	it('201s, upserts the system, and skips inherited refresh when not final', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		deriveSystemFromGamelistPath.mockReturnValue({
			id: 'snes',
			diskSource: 'usb0',
			romsBasePath: '/x/snes',
		})
		parseSystemGames.mockReturnValue([{ name: 'A' }, { name: 'B' }])
		upsertGames.mockResolvedValue(2)
		const res = await POST(req('Bearer x', validBody) as never)
		expect(res.status).toBe(201)
		const body = await res.json()
		expect(body.system).toBe('snes')
		expect(body.count).toBe(2)
		expect(upsertGames).toHaveBeenCalledWith([{ name: 'A' }, { name: 'B' }], 'snes', 'usb0', 'rb1')
		expect(importInheritedStatsFromGames).not.toHaveBeenCalled()
	})

	it('refreshes inherited stats once when final=true', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		deriveSystemFromGamelistPath.mockReturnValue({
			id: 'snes',
			diskSource: 'usb0',
			romsBasePath: '/x/snes',
		})
		parseSystemGames.mockReturnValue([])
		upsertGames.mockResolvedValue(0)
		importInheritedStatsFromGames.mockResolvedValue({ imported: 3, skipped: 0 })
		const res = await POST(req('Bearer x', { ...validBody, final: true }) as never)
		expect(res.status).toBe(201)
		const body = await res.json()
		expect(body.inheritedRefreshed).toBe(3)
		expect(importInheritedStatsFromGames).toHaveBeenCalledWith({}, 'rb1')
	})
})
