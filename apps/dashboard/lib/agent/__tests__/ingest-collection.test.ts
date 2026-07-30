import { describe, expect, it } from 'vitest'
import { deriveSystemFromGamelistPath, parseSystemGames } from '../ingest-collection'

describe('deriveSystemFromGamelistPath', () => {
	it('derives id/disk/base from an external USB gamelist path', () => {
		const d = deriveSystemFromGamelistPath(
			'/recalbox/share/externals/usb0/recalbox/roms/snes/gamelist.xml',
		)
		expect(d).toEqual({
			id: 'snes',
			diskSource: 'usb0',
			romsBasePath: '/recalbox/share/externals/usb0/recalbox/roms/snes',
		})
	})

	it('handles a second USB disk', () => {
		const d = deriveSystemFromGamelistPath(
			'/recalbox/share/externals/usb1/recalbox/roms/megadrive/gamelist.xml',
		)
		expect(d?.diskSource).toBe('usb1')
		expect(d?.id).toBe('megadrive')
	})

	it('returns null for the internal share (listSystems only scans externals)', () => {
		expect(deriveSystemFromGamelistPath('/recalbox/share/roms/snes/gamelist.xml')).toBeNull()
	})

	it('returns null for ports and unrelated paths', () => {
		expect(
			deriveSystemFromGamelistPath(
				'/recalbox/share/externals/usb0/recalbox/roms/ports/gamelist.xml',
			),
		).toBeNull()
		expect(deriveSystemFromGamelistPath('/etc/passwd')).toBeNull()
	})
})

describe('parseSystemGames', () => {
	const XML = `<?xml version="1.0"?>
<gameList>
  <game><path>./Super Mario World.sfc</path><name>Super Mario World</name><favorite>true</favorite></game>
</gameList>`
	const ROMS_BASE = '/recalbox/share/externals/usb0/recalbox/roms/snes'

	it('parses games from a gamelist xml', () => {
		const games = parseSystemGames(XML, ROMS_BASE)
		expect(games).toHaveLength(1)
		expect(games[0]?.name).toBe('Super Mario World')
		expect(games[0]?.favorite).toBe(true)
	})

	it('lets userdata.ini override favorite/play stats', () => {
		const rel = parseSystemGames(XML, ROMS_BASE)[0]?.relativeRomPath
		expect(rel).toBeDefined()
		const ini = `${rel}:favorite=false,playcount=7`
		const merged = parseSystemGames(XML, ROMS_BASE, ini)
		expect(merged[0]?.favorite).toBe(false)
		expect(merged[0]?.playCount).toBe(7)
	})
})
