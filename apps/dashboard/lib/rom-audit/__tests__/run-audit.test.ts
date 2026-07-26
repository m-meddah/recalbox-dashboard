import { describe, expect, it, vi } from 'vitest'
import type { CatalogResult } from '../catalog'
import type { Dat } from '../dat-parser'
import type { AuditResult } from '../match'
import { type AuditDeps, runAuditOverScan } from '../run-audit'
import type { ScanExecutor } from '../scan-runner'
import type { ScanTarget } from '../scan-targets'

function dat(name: string): Dat {
	return {
		name,
		version: '2026.05.02',
		games: [
			{
				name: 'Game (Europe)',
				roms: [{ name: 'Game (Europe).sfc', size: 1048576, crc: 'e95a3dd7' }],
			},
			{
				name: 'Other (Europe)',
				roms: [{ name: 'Other (Europe).sfc', size: 512, crc: 'aabbccdd' }],
			},
		],
	} as unknown as Dat
}

function entry(system: string, over: Record<string, unknown> = {}) {
	return {
		path: `/recalbox/share/roms/${system}/Game.zip`,
		size: 1048576,
		mtime: 1721900000,
		system,
		mount: '/recalbox/share',
		kind: 'zip-entry',
		crc32: 'E95A3DD7',
		innerName: 'Game (Europe).sfc',
		...over,
	}
}

function targets(...systems: string[]): ScanTarget[] {
	return systems.map((system) => ({
		mount: '/recalbox/share',
		system,
		romsPath: `/recalbox/share/roms/${system}`,
	}))
}

/** An executor answering with the entries of whichever systems the command asks for. */
function executor(entriesBySystem: Record<string, unknown[]>): ScanExecutor {
	return {
		exec: vi.fn(async (command: string) => {
			const asked = Object.keys(entriesBySystem).filter((s) => command.includes(`|${s}|`))
			const entries = asked.flatMap((s) => entriesBySystem[s] ?? [])
			return JSON.stringify({ entries, stats: { scanned: entries.length } })
		}),
	}
}

// Spreading the overrides into the literal would widen the mocks back to plain
// functions and lose `.mock` — wrap each override instead.
function deps(over: Partial<AuditDeps> = {}) {
	return {
		loadDat: vi.fn<AuditDeps['loadDat']>(
			over.loadDat ??
				(async (system: string): Promise<CatalogResult> => ({
					status: 'ok',
					dat: dat(system),
				})),
		),
		persist: vi.fn<AuditDeps['persist']>(over.persist ?? (async () => {})),
		onProgress: vi.fn<AuditDeps['onProgress']>(over.onProgress ?? (async () => {})),
	}
}

describe('runAuditOverScan', () => {
	it('audits each system against its own catalogue and persists it', async () => {
		const d = deps()
		const summary = await runAuditOverScan(
			executor({ snes: [entry('snes')], nes: [entry('nes')] }),
			targets('snes', 'nes'),
			d,
		)

		expect(summary.systemsAudited).toBe(2)
		expect(d.loadDat).toHaveBeenCalledWith('snes')
		expect(d.loadDat).toHaveBeenCalledWith('nes')
		expect(d.persist).toHaveBeenCalledTimes(2)

		const persisted = d.persist.mock.calls.map((c) => c[0])
		expect(new Set(persisted)).toEqual(new Set(['snes', 'nes']))
		const snes = d.persist.mock.calls.find((c) => c[0] === 'snes')?.[1] as AuditResult
		expect(snes.matchedRomEntries).toBe(1)
		expect(snes.files).toHaveLength(1)
		// The other system's entries must never leak into this audit.
		expect(snes.files.every((f) => f.system === 'snes')).toBe(true)
	})

	it('persists a system with no catalogue as inventory only', async () => {
		const d = deps({ loadDat: async () => ({ status: 'no-catalog' }) })
		const summary = await runAuditOverScan(
			executor({ amiga: [entry('amiga')] }),
			targets('amiga'),
			d,
		)

		expect(summary.systemsWithoutCatalog).toEqual(['amiga'])
		expect(d.persist).toHaveBeenCalledTimes(1)
		const result = d.persist.mock.calls[0]?.[1] as AuditResult
		expect(result.totalRomEntries).toBe(0)
		expect(result.files).toHaveLength(1)
		expect(result.files[0]?.matchLevel).toBe('unknown')
	})

	// Never persist a system whose scan failed: it would look like a collection
	// where everything is missing, which is worse than no data at all.
	it('does not persist a system whose batch failed', async () => {
		const d = deps()
		const ssh: ScanExecutor = { exec: vi.fn(async () => 'python3: command not found') }
		const summary = await runAuditOverScan(ssh, targets('snes'), d)

		expect(summary.failedSystems).toEqual(['snes'])
		expect(summary.systemsAudited).toBe(0)
		expect(d.persist).not.toHaveBeenCalled()
	})

	// A transient download failure must not wipe a previously good audit: the
	// aggregate would come back with an empty matchedEntries, i.e. "all missing".
	it('does not persist a system whose catalogue could not be downloaded', async () => {
		const d = deps({ loadDat: async () => ({ status: 'unavailable' }) })
		const summary = await runAuditOverScan(executor({ snes: [entry('snes')] }), targets('snes'), d)

		expect(summary.failedSystems).toEqual(['snes'])
		expect(d.persist).not.toHaveBeenCalled()
	})

	it('reports progress after each system', async () => {
		const d = deps()
		await runAuditOverScan(
			executor({ snes: [entry('snes')], nes: [], psx: [] }),
			targets('snes', 'nes', 'psx'),
			d,
		)
		const calls = d.onProgress.mock.calls as unknown as [number, number, string | null][]
		expect(calls.map((c) => c[0])).toEqual([1, 2, 3])
		expect(calls.every((c) => c[1] === 3)).toBe(true)
	})

	it('audits a system whose directory holds no scannable file', async () => {
		const d = deps()
		await runAuditOverScan(executor({ snes: [] }), targets('snes'), d)
		const result = d.persist.mock.calls[0]?.[1] as AuditResult
		expect(result.files).toEqual([])
		expect(result.matchedRomEntries).toBe(0)
		// Nothing owned means everything is missing — that is the honest answer.
		expect(result.missingGames.length).toBeGreaterThan(0)
	})

	it('reports the systems it could not batch at all', async () => {
		const d = deps()
		const huge: ScanTarget = {
			mount: '/recalbox/share',
			system: 'huge',
			romsPath: `/recalbox/share/roms/${'x'.repeat(9000)}`,
		}
		const summary = await runAuditOverScan(executor({}), [huge], d)
		expect(summary.oversized).toEqual(['huge'])
		expect(d.persist).not.toHaveBeenCalled()
	})

	it('never throws when persistence fails', async () => {
		const d = deps({
			persist: vi.fn(async () => {
				throw new Error('database is locked')
			}),
		})
		const summary = await runAuditOverScan(executor({ snes: [entry('snes')] }), targets('snes'), d)
		expect(summary.failedSystems).toEqual(['snes'])
		expect(summary.systemsAudited).toBe(0)
	})

	it('accepts a scan with no target at all', async () => {
		const d = deps()
		const summary = await runAuditOverScan(executor({}), [], d)
		expect(summary).toEqual({
			systemsAudited: 0,
			systemsWithoutCatalog: [],
			failedSystems: [],
			oversized: [],
		})
	})
})
