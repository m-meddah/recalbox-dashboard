import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateSystemsCache, listSystems } from '../systems'

/**
 * A box whose `externals` directory holds `supports`, each carrying `systems`
 * with a gamelist. The SD card is empty unless `sdSystems` says otherwise —
 * that is the common shape, and it keeps each test's expectation about the card
 * explicit.
 */
function box(supports: string[], systems: string[] = ['snes'], sdSystems: string[] = []) {
	return {
		exec: vi.fn(async (cmd: string) => {
			if (cmd.startsWith('ls -1 /recalbox/share/externals/ ')) return supports.join('\n')
			// shellQuote wraps in single quotes; matching on the quoted form keeps
			// this from also catching the externals' roms listings.
			if (cmd.includes("'/recalbox/share/roms'")) return sdSystems.join('\n')
			if (cmd.startsWith('ls -1 ')) return systems.join('\n')
			if (cmd.startsWith('test -f ')) return 'yes'
			return ''
		}),
	}
}

beforeEach(() => {
	invalidateSystemsCache()
})

describe('listSystems', () => {
	it('lists the systems of a usb disk', async () => {
		const found = await listSystems(box(['usb0']))
		expect(found).toHaveLength(1)
		expect(found[0]?.diskSource).toBe('usb0')
		expect(found[0]?.id).toBe('snes')
	})

	// Recalbox mounts a NAS under the same directory as the USB disks, as
	// network0…network3. A `usb\d+` filter made those collections invisible —
	// the sync reported nothing and said nothing.
	it('lists the systems of a network share', async () => {
		const found = await listSystems(box(['network0'], ['psx']))
		expect(found).toHaveLength(1)
		expect(found[0]?.diskSource).toBe('network0')
		expect(found[0]?.romsBasePath).toBe('/recalbox/share/externals/network0/recalbox/roms/psx')
	})

	it('covers every support recalbox documents, card included', async () => {
		const supports = [
			'usb0',
			'usb1',
			'usb2',
			'usb3',
			'network0',
			'network1',
			'network2',
			'network3',
		]
		const found = await listSystems(box(supports))
		expect(found.map((s) => s.diskSource)).toEqual(supports)
	})

	// The SD card was ignored for a long time: a system living there was invisible
	// to the whole dashboard, silently. On the reference box it held three
	// gamelists — 11 games nobody could see.
	it('lists the systems of the SD card', async () => {
		const found = await listSystems(box([], ['snes'], ['zx81', 'neogeo']))
		expect(found.map((s) => s.diskSource)).toEqual(['share', 'share'])
		expect(found.map((s) => s.id)).toEqual(['zx81', 'neogeo'])
		expect(found[0]?.romsBasePath).toBe('/recalbox/share/roms/zx81')
	})

	it('lists the card and the external supports side by side', async () => {
		const found = await listSystems(box(['usb0', 'network0'], ['psx'], ['zx81']))
		expect(found.map((s) => `${s.diskSource}:${s.id}`)).toEqual([
			'share:zx81',
			'usb0:psx',
			'network0:psx',
		])
	})

	it('ignores hidden entries and a parent segment', async () => {
		const found = await listSystems(box(['.Trash-1000', '..', 'usb0']))
		expect(found.map((s) => s.diskSource)).toEqual(['usb0'])
	})

	// A data disk mounted alongside the ROM supports yields no system rather than
	// an error — which is why accepting every entry is safe.
	it('yields nothing for a support with no roms directory', async () => {
		const ssh = {
			exec: vi.fn(async (cmd: string) => {
				if (cmd.startsWith('ls -1 /recalbox/share/externals/ ')) return 'backup\nusb0'
				if (cmd.includes("'/recalbox/share/roms'")) return ''
				if (cmd.includes('backup')) return ''
				if (cmd.startsWith('ls -1 ')) return 'snes'
				if (cmd.startsWith('test -f ')) return 'yes'
				return ''
			}),
		}
		const found = await listSystems(ssh)
		expect(found.map((s) => s.diskSource)).toEqual(['usb0'])
	})

	it('skips ports and a system with no gamelist', async () => {
		const ssh = {
			exec: vi.fn(async (cmd: string) => {
				if (cmd.startsWith('ls -1 /recalbox/share/externals/ ')) return 'usb0'
				if (cmd.includes("'/recalbox/share/roms'")) return ''
				if (cmd.startsWith('ls -1 ')) return 'ports\nsnes\nnes'
				if (cmd.startsWith('test -f ') && cmd.includes('/nes/')) return 'no'
				if (cmd.startsWith('test -f ')) return 'yes'
				return ''
			}),
		}
		const found = await listSystems(ssh)
		expect(found.map((s) => s.id)).toEqual(['snes'])
	})

	it('returns nothing when the box has no external support', async () => {
		expect(await listSystems(box([]))).toEqual([])
	})
})
