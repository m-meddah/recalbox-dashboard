import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getActiveRecalboxId = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()
const exec = vi.fn()
const writeFile = vi.fn()

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
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { GET, POST } from '../route'

const CONF =
	'emulationstation.rompreferredregion=fr\n' +
	'emulationstation.rompreferredfallback=Europe > Japan > World > USA\n' +
	'emulationstation.onegameonerom=1\n' +
	'audio.volume=90\n'

function postReq(body: unknown) {
	return new Request('http://x/api/recalbox/region-prefs', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	})
}

afterEach(() => {
	for (const m of [getUser, getActiveRecalboxId, canView, canControl, exec, writeFile])
		m.mockReset()
})

describe('GET /api/recalbox/region-prefs', () => {
	it('parses the four keys (booleans from 0/1)', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canView.mockReturnValue(true)
		exec.mockResolvedValue(CONF)
		const res = await GET()
		const json = await res.json()
		expect(json.prefs).toEqual({
			region: 'fr',
			fallback: 'Europe > Japan > World > USA',
			oneGameOneRom: true,
			showOnlyLatest: false, // absent → false
		})
	})

	it('401s without a user', async () => {
		getUser.mockResolvedValue(null)
		const res = await GET()
		expect(res.status).toBe(401)
	})
})

describe('POST /api/recalbox/region-prefs', () => {
	it('403s when the user cannot control the active recalbox', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-2')
		canControl.mockReturnValue(false)
		const res = await POST(
			postReq({ region: 'us', fallback: null, oneGameOneRom: false, showOnlyLatest: true }),
		)
		expect(res.status).toBe(403)
		expect(exec).not.toHaveBeenCalled()
	})

	it('rejects an invalid region code', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		const res = await POST(
			postReq({
				region: 'x; rm -rf /',
				fallback: null,
				oneGameOneRom: false,
				showOnlyLatest: false,
			}),
		)
		expect(res.status).toBe(400)
		expect(exec).not.toHaveBeenCalled()
	})

	it('rejects non-boolean flags', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		const res = await POST(postReq({ region: 'us', fallback: null, oneGameOneRom: 'yes' }))
		expect(res.status).toBe(400)
		expect(exec).not.toHaveBeenCalled()
	})

	it('writes the conf (with backup) on success, encoding booleans as 0/1', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		exec.mockResolvedValue(CONF)
		writeFile.mockResolvedValue(undefined)
		const res = await POST(
			postReq({ region: 'us', fallback: null, oneGameOneRom: false, showOnlyLatest: true }),
		)
		expect(res.status).toBe(200)
		const [path, content, opts] = writeFile.mock.calls[0] ?? []
		expect(path).toBe('/recalbox/share/system/recalbox.conf')
		expect(content).toContain('emulationstation.rompreferredregion=us')
		expect(content).toContain('emulationstation.onegameonerom=0')
		expect(content).toContain('emulationstation.showonlylatestversion=1')
		// fallback=null drops the key
		expect(content).not.toContain('emulationstation.rompreferredfallback=')
		expect((opts as { backupPath?: string })?.backupPath).toContain('.bak-dashboard')
	})
})
