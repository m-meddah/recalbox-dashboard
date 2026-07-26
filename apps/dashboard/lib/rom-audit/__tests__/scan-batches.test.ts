import { describe, expect, it } from 'vitest'
import { planScanBatches } from '../scan-batches'
import { buildScanCommand } from '../scan-runner'
import type { ScanTarget } from '../scan-targets'

const MOUNTS = [
	'/recalbox/share',
	'/recalbox/share/externals/usb0',
	'/recalbox/share/externals/usb1',
]

/** One system as the real box presents it: the same system on every mount. */
function system(id: string): ScanTarget[] {
	return MOUNTS.map((mount) => ({
		mount,
		system: id,
		romsPath: mount === '/recalbox/share' ? `${mount}/roms/${id}` : `${mount}/recalbox/roms/${id}`,
	}))
}

function targetsFor(count: number): ScanTarget[] {
	return Array.from({ length: count }, (_, i) => system(`system${i}`)).flat()
}

describe('planScanBatches', () => {
	it('keeps a small scan in a single batch', () => {
		const plan = planScanBatches(targetsFor(3))
		expect(plan.batches).toHaveLength(1)
		expect(plan.batches[0]?.systems).toEqual(['system0', 'system1', 'system2'])
		expect(plan.oversized).toEqual([])
	})

	// The real motivation: 126 systems across three mounts is far over the limit.
	it('splits a whole-box scan into several batches', () => {
		const plan = planScanBatches(targetsFor(126))
		expect(plan.batches.length).toBeGreaterThan(1)
		for (const batch of plan.batches) {
			expect(buildScanCommand(batch.targets).length).toBeLessThanOrEqual(8000)
		}
	})

	// A system split across two batches would be audited twice against the same
	// DAT, each half looking incomplete. The boundary must fall between systems.
	it('never splits one system across two batches', () => {
		const plan = planScanBatches(targetsFor(126))
		const seen = new Set<string>()
		for (const batch of plan.batches) {
			for (const s of batch.systems) {
				expect(seen.has(s)).toBe(false)
				seen.add(s)
			}
			for (const t of batch.targets) expect(batch.systems).toContain(t.system)
		}
		expect(seen.size).toBe(126)
	})

	it('covers every target exactly once', () => {
		const targets = targetsFor(40)
		const plan = planScanBatches(targets)
		const packed = plan.batches.flatMap((b) => b.targets)
		expect(packed).toHaveLength(targets.length)
		expect(new Set(packed.map((t) => `${t.mount}|${t.system}`)).size).toBe(targets.length)
	})

	it('is deterministic and orders systems predictably', () => {
		const a = planScanBatches(targetsFor(30))
		const b = planScanBatches(targetsFor(30))
		expect(a).toEqual(b)
	})

	// Degenerate but possible: one system whose paths alone blow the budget.
	// It must be reported, not silently dropped and not packed into a doomed batch.
	it('reports a system that cannot fit in any batch', () => {
		const huge: ScanTarget = {
			mount: '/recalbox/share',
			system: 'huge',
			romsPath: `/recalbox/share/roms/${'x'.repeat(9000)}`,
		}
		const plan = planScanBatches([huge, ...system('snes')])
		expect(plan.oversized).toEqual(['huge'])
		expect(plan.batches.flatMap((b) => b.systems)).toEqual(['snes'])
	})

	it('accepts an empty target list', () => {
		expect(planScanBatches([])).toEqual({ batches: [], oversized: [] })
	})
})

// The scanner cannot know a system's hash mode: the catalogue does, and the
// command is the only channel that reaches the box.
describe('buildScanCommand (hash mode)', () => {
	it('passes the hash mode of an arcade target', () => {
		const cmd = buildScanCommand([
			{ mount: '/m', system: 'mame', romsPath: '/m/roms/mame', hashMode: 'container' },
		])
		expect(cmd).toContain('/m|mame|/m/roms/mame|container')
	})

	// Omitted for content targets: the script already defaults to it, and the
	// command budget is 8000 bytes for the whole batch.
	it('omits it for a content target, keeping the command short', () => {
		const cmd = buildScanCommand([
			{ mount: '/m', system: 'snes', romsPath: '/m/roms/snes', hashMode: 'content' },
		])
		expect(cmd).toContain('/m|snes|/m/roms/snes')
		expect(cmd).not.toContain('|content')
	})

	it('omits it when the target declares no mode at all', () => {
		const cmd = buildScanCommand([{ mount: '/m', system: 'snes', romsPath: '/m/roms/snes' }])
		expect(cmd).not.toContain('|content')
	})
})
