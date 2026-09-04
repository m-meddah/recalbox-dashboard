import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const isAdmin = vi.fn()
const readFleetVersions = vi.fn()
const readRolloutSettings = vi.fn()
const writeRolloutSettings = vi.fn()
const readAgentVersion = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/auth/require-user', () => ({
	getUser: () => getUser(),
	unauthorized: () => new Response(null, { status: 401 }),
	forbidden: () => new Response(null, { status: 403 }),
}))
vi.mock('@/lib/auth/ownership', () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }))
vi.mock('@/lib/db/agent-rollout-queries', () => ({
	readFleetVersions: () => readFleetVersions(),
}))
vi.mock('@/lib/agent/rollout-settings', () => ({
	readRolloutSettings: () => readRolloutSettings(),
	writeRolloutSettings: (...a: unknown[]) => writeRolloutSettings(...a),
}))
vi.mock('@/lib/agent/payload', () => ({ readAgentVersion: () => readAgentVersion() }))

import { GET, PUT } from '../route'

function put(body: unknown) {
	return { json: async () => body } as never
}

afterEach(() => {
	for (const m of [
		getUser,
		isAdmin,
		readFleetVersions,
		readRolloutSettings,
		writeRolloutSettings,
		readAgentVersion,
	]) {
		m.mockReset()
	}
})

function asAdmin() {
	getUser.mockResolvedValue({ id: 'u1' })
	isAdmin.mockReturnValue(true)
	readAgentVersion.mockResolvedValue('1.1.0')
	readRolloutSettings.mockResolvedValue({
		targetVersion: '1.1.0',
		rolloutPercent: 0,
		previousTargetVersion: null,
	})
	readFleetVersions.mockResolvedValue([{ version: '1.0.0', boxes: 2, seenLastHour: 2 }])
}

describe('GET /api/agent-rollout', () => {
	it('401s when signed out', async () => {
		getUser.mockResolvedValue(null)
		expect((await GET()).status).toBe(401)
	})

	it('403s for a non-admin', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		isAdmin.mockReturnValue(false)
		expect((await GET()).status).toBe(403)
	})

	it('returns the deployed version, the settings and the fleet', async () => {
		asAdmin()
		const body = await (await GET()).json()
		expect(body).toEqual({
			deployedVersion: '1.1.0',
			targetVersion: '1.1.0',
			rolloutPercent: 0,
			previousTargetVersion: null,
			versions: [{ version: '1.0.0', boxes: 2, seenLastHour: 2 }],
		})
	})
})

describe('PUT /api/agent-rollout', () => {
	it('403s for a non-admin', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		isAdmin.mockReturnValue(false)
		expect((await PUT(put({ rolloutPercent: 50 }))).status).toBe(403)
	})

	it('accepts a percentage', async () => {
		asAdmin()
		expect((await PUT(put({ rolloutPercent: 50 }))).status).toBe(200)
		expect(writeRolloutSettings).toHaveBeenCalledWith({ rolloutPercent: 50 })
	})

	it('accepts the deployed version as a target', async () => {
		asAdmin()
		expect((await PUT(put({ targetVersion: '1.1.0' }))).status).toBe(200)
	})

	it('accepts a version some box actually reports', async () => {
		asAdmin()
		expect((await PUT(put({ targetVersion: '1.0.0' }))).status).toBe(200)
	})

	it('accepts the previous target after a rollout has reached every box', async () => {
		// The lever that must not disappear. At 100% nobody declares 1.0.0 any
		// more, so the telemetry-built allow-list no longer holds it — while
		// every console still keeps it in backup/ and could restore it in
		// seconds.
		asAdmin()
		readRolloutSettings.mockResolvedValue({
			targetVersion: '1.1.0',
			rolloutPercent: 100,
			previousTargetVersion: '1.0.0',
		})
		readFleetVersions.mockResolvedValue([{ version: '1.1.0', boxes: 3, seenLastHour: 3 }])
		expect((await PUT(put({ targetVersion: '1.0.0' }))).status).toBe(200)
		expect(writeRolloutSettings).toHaveBeenCalledWith({ targetVersion: '1.0.0' })
	})

	it('still refuses a version that was never a target and nobody runs', async () => {
		asAdmin()
		readRolloutSettings.mockResolvedValue({
			targetVersion: '1.1.0',
			rolloutPercent: 100,
			previousTargetVersion: '1.0.0',
		})
		readFleetVersions.mockResolvedValue([{ version: '1.1.0', boxes: 3, seenLastHour: 3 }])
		const res = await PUT(put({ targetVersion: '0.9.0' }))
		expect(res.status).toBe(422)
		expect(writeRolloutSettings).not.toHaveBeenCalled()
	})

	it('refuses a version that exists nowhere', async () => {
		// A typo here would send the whole fleet converging towards nothing —
		// and since nobody could reach it, nothing would move: a silent outage.
		asAdmin()
		const res = await PUT(put({ targetVersion: '1.1.O' }))
		expect(res.status).toBe(422)
		expect(writeRolloutSettings).not.toHaveBeenCalled()
	})

	it('refuses a percentage out of range', async () => {
		asAdmin()
		expect((await PUT(put({ rolloutPercent: 500 }))).status).toBe(422)
	})
})
