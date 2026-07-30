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

	// Contract changed on purpose: this used to return null because listSystems
	// only scanned the externals, which made a collection on the SD card
	// invisible to the whole dashboard. On the reference box the card held three
	// gamelists — 11 games nobody could see.
	it('derives a system from the SD card', () => {
		const d = deriveSystemFromGamelistPath('/recalbox/share/roms/snes/gamelist.xml')
		expect(d).toEqual({
			id: 'snes',
			diskSource: 'share',
			romsBasePath: '/recalbox/share/roms/snes',
		})
	})

	// An external path also contains `/recalbox/roms/`; the two patterns must not
	// overlap, or a USB game would be recorded as living on the card.
	it('still attributes an external path to its own support', () => {
		const d = deriveSystemFromGamelistPath(
			'/recalbox/share/externals/network0/recalbox/roms/snes/gamelist.xml',
		)
		expect(d?.diskSource).toBe('network0')
	})

	it('refuses ports and hidden systems on the SD card too', () => {
		expect(deriveSystemFromGamelistPath('/recalbox/share/roms/ports/gamelist.xml')).toBeNull()
		expect(deriveSystemFromGamelistPath('/recalbox/share/roms/.hidden/gamelist.xml')).toBeNull()
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

// Recalbox mounts a NAS as network0…network3 under the same directory as the
// USB disks. The old `usb\d+` pattern made the agent's push of those gamelists
// come back 400: the file was read, sent, and silently rejected, so a NAS user
// saw an empty collection with no error anywhere.
describe('deriveSystemFromGamelistPath (network shares)', () => {
	it('accepts a gamelist on a network share', () => {
		const d = deriveSystemFromGamelistPath(
			'/recalbox/share/externals/network0/recalbox/roms/snes/gamelist.xml',
		)
		expect(d?.diskSource).toBe('network0')
		expect(d?.id).toBe('snes')
		expect(d?.romsBasePath).toBe('/recalbox/share/externals/network0/recalbox/roms/snes')
	})

	it('accepts every network index recalbox documents', () => {
		for (const n of [0, 1, 2, 3]) {
			const d = deriveSystemFromGamelistPath(
				`/recalbox/share/externals/network${n}/recalbox/roms/psx/gamelist.xml`,
			)
			expect(d?.diskSource).toBe(`network${n}`)
		}
	})

	it('accepts usb2 and usb3, which the old pattern allowed but nothing produced', () => {
		expect(
			deriveSystemFromGamelistPath('/recalbox/share/externals/usb3/recalbox/roms/nes/gamelist.xml')
				?.diskSource,
		).toBe('usb3')
	})

	// The support name is wider than `usb\d+` now, and it is stored and re-used to
	// rebuild a path — so it must not be able to climb out of the share.
	it('refuses a support name that would escape the share', () => {
		expect(
			deriveSystemFromGamelistPath('/recalbox/share/externals/../recalbox/roms/snes/gamelist.xml'),
		).toBeNull()
		expect(
			deriveSystemFromGamelistPath(
				'/recalbox/share/externals/.hidden/recalbox/roms/snes/gamelist.xml',
			),
		).toBeNull()
	})
})
