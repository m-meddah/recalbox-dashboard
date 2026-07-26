import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fetchForVerify, isVerifiablePath } from '../deep-verify-fetch'

describe('isVerifiablePath', () => {
	it('accepts a path inside the share', () => {
		expect(isVerifiablePath('/recalbox/share/roms/psx/Game.chd')).toBe(true)
		expect(isVerifiablePath('/recalbox/share/externals/usb0/recalbox/roms/gamecube/G.rvz')).toBe(
			true,
		)
	})

	// The row comes from the box, but a row outlives what it described and reaches
	// a download call and a process argument.
	it('refuses a path outside the share', () => {
		expect(isVerifiablePath('/etc/passwd')).toBe(false)
		expect(isVerifiablePath('/recalbox/system/secret')).toBe(false)
		expect(isVerifiablePath('relative/path.chd')).toBe(false)
	})

	it('refuses a path holding a parent segment', () => {
		expect(isVerifiablePath('/recalbox/share/roms/../../etc/passwd')).toBe(false)
	})

	it('refuses a path carrying a control character', () => {
		// Écrits en échappements : un octet de contrôle littéral dans la source
		// est invisible à la relecture et ne survit pas forcément aux outils.
		expect(isVerifiablePath('/recalbox/share/roms/psx/G\u000Aame.chd')).toBe(false)
		expect(isVerifiablePath('/recalbox/share/roms/psx/G\u0000.chd')).toBe(false)
		expect(isVerifiablePath('/recalbox/share/roms/psx/G\u001B[31m.chd')).toBe(false)
	})

	// The share is full of them, and refusing these would break the feature.
	it('accepts a name with spaces, commas and apostrophes', () => {
		expect(isVerifiablePath("/recalbox/share/roms/psx/Tower of Druaga, The (Japan) 'x'.chd")).toBe(
			true,
		)
	})
})

describe('fetchForVerify', () => {
	it('downloads into a temp dir outside the project and hands back the cleanup', async () => {
		const download = vi.fn(async (_remote: string, local: string) => {
			await writeFile(local, 'payload')
		})
		const res = await fetchForVerify('/recalbox/share/roms/psx/Game.chd', download)
		expect(res.status).toBe('ok')
		if (res.status !== 'ok') throw new Error('expected ok')

		expect(res.localPath).not.toContain(process.cwd())
		expect(path.basename(res.localPath)).toBe('Game.chd')
		expect(existsSync(res.localPath)).toBe(true)

		await res.cleanup()
		expect(existsSync(res.localPath)).toBe(false)
	})

	it('rejects a bad path before downloading anything', async () => {
		const download = vi.fn()
		const res = await fetchForVerify('/etc/passwd', download)
		expect(res.status).toBe('rejected')
		expect(download).not.toHaveBeenCalled()
	})

	// A few GB per verification fills a disk in a handful of attempts, so a
	// failed download must not leave its directory behind.
	it('cleans up after a failed download', async () => {
		let attempted = ''
		const download = vi.fn(async (_remote: string, local: string) => {
			attempted = local
			throw new Error('connection reset')
		})
		const res = await fetchForVerify('/recalbox/share/roms/psx/Game.chd', download)
		expect(res.status).toBe('failed')
		expect(existsSync(path.dirname(attempted))).toBe(false)
	})

	it('never throws when the download blows up', async () => {
		await expect(
			fetchForVerify('/recalbox/share/roms/psx/G.chd', async () => {
				throw new Error('boom')
			}),
		).resolves.toBeDefined()
	})

	it('gives each verification its own directory', async () => {
		const download = async (_r: string, local: string) => {
			await writeFile(local, 'x')
		}
		const a = await fetchForVerify('/recalbox/share/roms/psx/Game.chd', download)
		const b = await fetchForVerify('/recalbox/share/roms/psx/Game.chd', download)
		if (a.status !== 'ok' || b.status !== 'ok') throw new Error('expected ok')
		expect(path.dirname(a.localPath)).not.toBe(path.dirname(b.localPath))
		await a.cleanup()
		await b.cleanup()
	})
})
