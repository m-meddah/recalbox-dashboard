import { beforeEach, describe, expect, it, vi } from 'vitest'

const execMock = vi.fn()
vi.mock('@/lib/recalbox/ssh-client', () => ({
	getSshClient: vi.fn(() => ({ exec: execMock })),
}))

import { getEsState, parseEsState } from '@/lib/recalbox/es-state'

beforeEach(() => {
	execMock.mockReset()
})

const PLAYING = [
	'System=Super Nintendo',
	'SystemId=snes',
	'Game=The Legend of Zelda',
	'GamePath=/recalbox/share/roms/snes/Zelda.zip',
	'State=playing',
	'',
].join('\n')

const BROWSING = ['SystemId=snes', 'Game=Contra III', 'State=selected', ''].join('\n')

describe('parseEsState', () => {
	it('flags a running game and extracts its name', () => {
		const s = parseEsState(PLAYING)
		expect(s.gameRunning).toBe(true)
		expect(s.gameName).toBe('The Legend of Zelda')
		expect(s.raw.SystemId).toBe('snes')
	})

	it('is not running while browsing the menus', () => {
		const s = parseEsState(BROWSING)
		expect(s.gameRunning).toBe(false)
		expect(s.gameName).toBeNull()
	})

	it('tolerates blank lines, missing keys and values containing "="', () => {
		const s = parseEsState('\nGamePath=/roms/a=b.zip\nState=playing\nGame=Mega Man\n=oops\n')
		expect(s.gameRunning).toBe(true)
		expect(s.gameName).toBe('Mega Man')
		expect(s.raw.GamePath).toBe('/roms/a=b.zip')
		expect(s.raw['']).toBeUndefined()
	})

	it('reports no name when State=playing but Game is absent', () => {
		const s = parseEsState('State=playing\n')
		expect(s.gameRunning).toBe(true)
		expect(s.gameName).toBeNull()
	})
})

describe('getEsState', () => {
	it('reads and parses the state file over SSH', async () => {
		execMock.mockResolvedValue(PLAYING)
		const s = await getEsState('rb1')
		expect(s?.gameRunning).toBe(true)
		expect(s?.gameName).toBe('The Legend of Zelda')
		expect(execMock.mock.calls[0]?.[0]).toContain('es_state.inf')
	})

	it('returns null when the file is empty/absent', async () => {
		execMock.mockResolvedValue('')
		expect(await getEsState('rb1')).toBeNull()
	})

	it('returns null (never throws) when SSH fails', async () => {
		execMock.mockImplementation(() => {
			throw new Error('ssh down')
		})
		expect(await getEsState('rb1')).toBeNull()
	})
})
