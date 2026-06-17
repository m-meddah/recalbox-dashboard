import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getActiveRecalboxId = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()
const exec = vi.fn()
const writeFile = vi.fn()
const readOverclockInfo = vi.fn()

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
vi.mock('@/lib/recalbox/active', () => ({ getActiveRecalboxId: () => getActiveRecalboxId() }))
vi.mock('@/lib/recalbox/ssh-client', () => ({
	getSshClient: () => ({
		exec: (...a: unknown[]) => exec(...a),
		writeFile: (...a: unknown[]) => writeFile(...a),
	}),
}))
vi.mock('@/lib/recalbox/overclock', () => ({
	OVERCLOCK_KEY: 'system.overclocking',
	readOverclockInfo: (...a: unknown[]) => readOverclockInfo(...a),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { POST } from '../route'

const CONF =
	'system.overclocking=/recalbox/system/configs/overclocking/rpi5/medium.txt\naudio.volume=90\n'
const INFO = {
	supported: true,
	modelName: 'Raspberry Pi 5 Model B',
	board: 'rpi5',
	profilesDir: '/recalbox/system/configs/overclocking/rpi5',
	available: ['high', 'medium'],
	current: 'medium',
	temp: 57.6,
	throttle: {
		raw: '0x0',
		underVoltageNow: false,
		throttledNow: false,
		underVoltageOccurred: false,
		throttledOccurred: false,
	},
}

function postReq(body: unknown) {
	return new Request('http://x/api/recalbox/overclock', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	})
}

afterEach(() => {
	for (const m of [
		getUser,
		getActiveRecalboxId,
		canView,
		canControl,
		exec,
		writeFile,
		readOverclockInfo,
	])
		m.mockReset()
})

describe('POST /api/recalbox/overclock', () => {
	it('403s when the user cannot control the active recalbox', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-2')
		canControl.mockReturnValue(false)
		const res = await POST(postReq({ profile: 'high' }))
		expect(res.status).toBe(403)
		expect(writeFile).not.toHaveBeenCalled()
	})

	it('rejects a profile not in the available list (anti path-injection)', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		readOverclockInfo.mockResolvedValue(INFO)
		const res = await POST(postReq({ profile: '../../../etc/evil' }))
		expect(res.status).toBe(400)
		expect(writeFile).not.toHaveBeenCalled()
	})

	it('400s when overclocking is not supported', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		readOverclockInfo.mockResolvedValue({ ...INFO, supported: false, available: [] })
		const res = await POST(postReq({ profile: 'high' }))
		expect(res.status).toBe(400)
	})

	it('writes the chosen profile path (with backup)', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		readOverclockInfo.mockResolvedValue(INFO)
		exec.mockResolvedValue(CONF)
		writeFile.mockResolvedValue(undefined)
		const res = await POST(postReq({ profile: 'high' }))
		expect(res.status).toBe(200)
		const [path, content, opts] = writeFile.mock.calls[0] ?? []
		expect(path).toBe('/recalbox/share/system/recalbox.conf')
		expect(content).toContain(
			'system.overclocking=/recalbox/system/configs/overclocking/rpi5/high.txt',
		)
		expect((opts as { backupPath?: string })?.backupPath).toContain('.bak-dashboard')
	})

	it('clears the key when profile is null (stock clocks)', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		readOverclockInfo.mockResolvedValue(INFO)
		exec.mockResolvedValue(CONF)
		writeFile.mockResolvedValue(undefined)
		const res = await POST(postReq({ profile: null }))
		expect(res.status).toBe(200)
		const [, content] = writeFile.mock.calls[0] ?? []
		expect(content).not.toContain('system.overclocking=')
	})
})
