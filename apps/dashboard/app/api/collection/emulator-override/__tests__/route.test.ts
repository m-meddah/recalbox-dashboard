import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getActiveRecalboxId = vi.fn()
const canControl = vi.fn()
const getEsState = vi.fn()
const listSystems = vi.fn()
const readGamelist = vi.fn()
const updateDb = vi.fn()
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
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
}))
vi.mock('@/lib/recalbox/active', () => ({ getActiveRecalboxId: () => getActiveRecalboxId() }))
vi.mock('@/lib/recalbox/es-state', () => ({ getEsState: () => getEsState() }))
vi.mock('@/lib/recalbox/systems', () => ({ listSystems: () => listSystems() }))
vi.mock('@/lib/recalbox/gamelist-reader', () => ({
	readGamelist: (...a: unknown[]) => readGamelist(...a),
}))
vi.mock('@/lib/recalbox/ssh-client', () => ({
	getSshClient: () => ({
		exec: (...a: unknown[]) => exec(...a),
		writeFile: (...a: unknown[]) => writeFile(...a),
	}),
}))
vi.mock('@/lib/db/queries', () => ({
	updateGameEmulatorOverride: (...a: unknown[]) => updateDb(...a),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { POST } from '../route'

const SYS = {
	id: 'snes',
	gamelistPath: '/roms/snes/gamelist.xml',
	romsBasePath: '/roms/snes',
	diskSource: 'share',
}
const XML =
	'<gameList>\n\t<game>\n\t\t<name>Mario</name>\n\t\t<path>./Mario.sfc</path>\n\t</game>\n</gameList>\n'

function req(body: unknown) {
	return new Request('http://x/api/collection/emulator-override', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	}) as never
}

afterEach(() => {
	for (const m of [
		getUser,
		getActiveRecalboxId,
		canControl,
		getEsState,
		listSystems,
		readGamelist,
		updateDb,
		exec,
		writeFile,
	])
		m.mockReset()
})

describe('POST /api/collection/emulator-override', () => {
	it('403s when the user does not own the active recalbox', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-2')
		canControl.mockReturnValue(false)
		const res = await POST(
			req({
				romPath: '/roms/snes/Mario.sfc',
				system: 'snes',
				emulator: 'libretro',
				core: 'snes9x',
			}),
		)
		expect(res.status).toBe(403)
		expect(writeFile).not.toHaveBeenCalled()
	})

	it('409s when a game is running', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		getEsState.mockResolvedValue({ gameRunning: true, gameName: 'Zelda' })
		const res = await POST(
			req({
				romPath: '/roms/snes/Mario.sfc',
				system: 'snes',
				emulator: 'libretro',
				core: 'snes9x',
			}),
		)
		expect(res.status).toBe(409)
		expect(writeFile).not.toHaveBeenCalled()
	})

	it('rejects a malformed emulator id', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		const res = await POST(
			req({ romPath: '/roms/snes/Mario.sfc', system: 'snes', emulator: 'bad; rm -rf', core: null }),
		)
		expect(res.status).toBe(400)
	})

	it('writes the gamelist (with backup) and updates the DB on success', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		getEsState.mockResolvedValue({ gameRunning: false })
		listSystems.mockResolvedValue([SYS])
		readGamelist.mockResolvedValue(XML)
		writeFile.mockResolvedValue(undefined)
		updateDb.mockResolvedValue(1)

		const res = await POST(
			req({
				romPath: '/roms/snes/Mario.sfc',
				system: 'snes',
				emulator: 'libretro',
				core: 'snes9x',
			}),
		)
		expect(res.status).toBe(200)
		const [path, content, opts] = writeFile.mock.calls[0] ?? []
		expect(path).toBe('/roms/snes/gamelist.xml')
		expect(content).toContain('<emulator>libretro</emulator>')
		expect((opts as { backupPath?: string })?.backupPath).toBe(
			'/roms/snes/gamelist.xml.bak-dashboard',
		)
		expect(updateDb).toHaveBeenCalledWith('rb-1', '/roms/snes/Mario.sfc', 'libretro', 'snes9x')
	})

	it('404s when the game is not in the gamelist', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		getEsState.mockResolvedValue({ gameRunning: false })
		listSystems.mockResolvedValue([SYS])
		readGamelist.mockResolvedValue(XML)
		const res = await POST(
			req({
				romPath: '/roms/snes/Missing.sfc',
				system: 'snes',
				emulator: 'libretro',
				core: 'snes9x',
			}),
		)
		expect(res.status).toBe(404)
		expect(writeFile).not.toHaveBeenCalled()
	})
})
