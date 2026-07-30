import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateSystemsCache, listSystems } from '../systems'

/**
 * A box whose `externals` directory holds `supports`, each carrying `systems`
 * with a gamelist.
 */
function box(supports: string[], systems: string[] = ['snes']) {
	return {
		exec: vi.fn(async (cmd: string) => {
			if (cmd.startsWith('ls -1 /recalbox/share/externals/ ')) return supports.join('\n')
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

	it('covers every support recalbox documents', async () => {
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
