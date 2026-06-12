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

const CONF = 'global.emulator=libretro\nsnes.emulator=libretro\nsnes.core=snes9x\naudio.volume=90\n'

function postReq(body: unknown) {
	return new Request('http://x/api/recalbox/system-emulator', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	})
}

afterEach(() => {
	for (const m of [getUser, getActiveRecalboxId, canView, canControl, exec, writeFile])
		m.mockReset()
})

describe('GET /api/recalbox/system-emulator', () => {
	it('returns per-system overrides, excluding global', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canView.mockReturnValue(true)
		exec.mockResolvedValue(CONF)
		const res = await GET()
		const json = await res.json()
		expect(json.overrides).toEqual({ snes: { emulator: 'libretro', core: 'snes9x' } })
	})
})

describe('POST /api/recalbox/system-emulator', () => {
	it('403s when the user does not own the active recalbox', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-2')
		canControl.mockReturnValue(false)
		const res = await POST(postReq({ system: 'snes', emulator: 'libretro', core: 'snes9x' }))
		expect(res.status).toBe(403)
		expect(exec).not.toHaveBeenCalled()
	})

	it('writes the conf (with backup) on success', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		exec.mockResolvedValue(CONF) // readConf
		writeFile.mockResolvedValue(undefined)
		const res = await POST(postReq({ system: 'snes', emulator: 'libretro', core: 'snes9x2010' }))
		expect(res.status).toBe(200)
		const [path, content, opts] = writeFile.mock.calls[0] ?? []
		expect(path).toBe('/recalbox/share/system/recalbox.conf')
		expect(content).toContain('snes.core=snes9x2010')
		expect((opts as { backupPath?: string })?.backupPath).toContain('.bak-dashboard')
	})

	it('rejects a malformed core id', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		const res = await POST(postReq({ system: 'snes', emulator: 'libretro', core: 'x; rm -rf /' }))
		expect(res.status).toBe(400)
		expect(exec).not.toHaveBeenCalled()
	})
})
