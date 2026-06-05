import { beforeEach, describe, expect, it, vi } from 'vitest'

const execMock = vi.fn().mockResolvedValue('')
vi.mock('@/lib/recalbox/ssh-client', () => ({
	getSshClient: vi.fn(() => ({ exec: execMock })),
}))

import { isLaunchable, launchGame } from '@/lib/recalbox/launch-game'

beforeEach(() => execMock.mockClear())

describe('isLaunchable', () => {
	it('accepts a normal rom under the share tree', () => {
		expect(isLaunchable('snes', '/recalbox/share/roms/snes/Zelda.zip')).toBe(true)
		expect(isLaunchable('megadrive', '/recalbox/share/externals/usb0/recalbox/roms/md/g.7z')).toBe(
			true,
		)
	})

	it('rejects invalid system ids', () => {
		expect(isLaunchable('Snes', '/recalbox/share/x')).toBe(false) // uppercase
		expect(isLaunchable('snes-eu', '/recalbox/share/x')).toBe(false) // dash
		expect(isLaunchable('', '/recalbox/share/x')).toBe(false)
	})

	it('rejects paths outside the share tree', () => {
		expect(isLaunchable('snes', '/etc/passwd')).toBe(false)
		expect(isLaunchable('snes', '/recalbox/system/secret')).toBe(false)
	})

	it('rejects paths that would break the pipe-delimited command framing', () => {
		expect(isLaunchable('snes', '/recalbox/share/roms/snes/a|b.zip')).toBe(false)
		expect(isLaunchable('snes', '/recalbox/share/roms/snes/a\nb.zip')).toBe(false)
	})
})

describe('launchGame', () => {
	it('sends a base64 START payload to ES over SSH', async () => {
		await launchGame('rb1', 'snes', '/recalbox/share/roms/snes/Zelda.zip')

		expect(execMock).toHaveBeenCalledTimes(1)
		const cmd = execMock.mock.calls[0]?.[0] as string
		const expected = Buffer.from('START|snes|/recalbox/share/roms/snes/Zelda.zip').toString(
			'base64',
		)
		expect(cmd).toContain(expected)
		expect(cmd).toContain('base64 -d')
		expect(cmd).toContain('1337')
	})

	it('handles rom paths with spaces, quotes and parens without shell escaping', async () => {
		const rom = "/recalbox/share/roms/snes/0-9/'96 Soccer (Japan).7z"
		await launchGame('rb1', 'snes', rom)
		const cmd = execMock.mock.calls[0]?.[0] as string
		// path is carried inside the base64 blob, never interpolated into the shell
		expect(cmd).toContain(Buffer.from(`START|snes|${rom}`).toString('base64'))
		expect(cmd).not.toContain("'96 Soccer")
	})

	it('throws and never touches SSH for invalid input', async () => {
		await expect(launchGame('rb1', 'bad id', '/etc/passwd')).rejects.toThrow()
		expect(execMock).not.toHaveBeenCalled()
	})
})
