import { describe, expect, it, vi } from 'vitest'
import type { ScanCache } from '../scan-cache'
import { buildScanCommand, runScan, runScanBatched } from '../scan-runner'
import type { ScanTarget } from '../scan-targets'

const TARGETS: ScanTarget[] = [
	{ mount: '/recalbox/share', system: 'snes', romsPath: '/recalbox/share/roms/snes' },
]

const VALID_ENTRY = {
	path: '/recalbox/share/roms/snes/Game.zip',
	size: 1048576,
	mtime: 1721900000,
	system: 'snes',
	mount: '/recalbox/share',
	kind: 'zip-entry',
	crc32: 'E95A3DD7',
	innerName: 'Game (Europe).sfc',
}

function ssh(
	exec: (cmd: string, options: { stdin: string; timeoutMs: number }) => Promise<string>,
) {
	return { exec: vi.fn(exec) }
}

describe('buildScanCommand', () => {
	it('reads the script from stdin rather than writing it to the box', () => {
		const cmd = buildScanCommand(TARGETS)
		expect(cmd).toContain('python3 -')
		// Rien ne doit subsister sur la Recalbox : ce lot est en lecture seule.
		expect(cmd).not.toMatch(/>\s*\/recalbox/)
	})

	// Mesuré sur la box de référence : un exec SSH échoue entre 8 et 16 Ko de
	// ligne de commande, et une commande de 32 Ko coupe carrément la connexion.
	// Le script fait 21 Ko : l'embarquer dans la commande ne peut pas marcher.
	it('stays far below the ssh exec limit for a one-system scan', () => {
		const perMount = [
			'/recalbox/share',
			'/recalbox/share/externals/usb0',
			'/recalbox/share/externals/usb1',
		].map((mount) => ({ mount, system: 'snes', romsPath: `${mount}/recalbox/roms/snes` }))
		expect(buildScanCommand(perMount).length).toBeLessThan(8000)
	})

	it('carries the script through stdin, not through the command', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		await runScan(client, TARGETS)
		const [cmd, options] = client.exec.mock.calls[0] ?? []
		expect(cmd?.length ?? 0).toBeLessThan(8000)
		expect(options?.stdin).toContain('#!/usr/bin/env python3')
	})

	it('passes each target as an argument', () => {
		const cmd = buildScanCommand(TARGETS)
		expect(cmd).toContain('--target')
		expect(cmd).toContain('/recalbox/share/roms/snes')
	})

	// Les chemins viennent d'un listage de la box et contiennent couramment des
	// espaces et des apostrophes.
	it('quotes a target path containing a space and a quote', () => {
		const cmd = buildScanCommand([
			{ mount: '/mnt', system: 'snes', romsPath: "/mnt/mes jeux/l'aventure" },
		])
		expect(cmd).not.toMatch(/--target\s+\/mnt\/mes jeux/)
		expect(cmd).toContain("'\\''")
	})
})

describe('runScan', () => {
	it('returns the validated entries on a well-formed run', async () => {
		const client = ssh(async () =>
			JSON.stringify({ entries: [VALID_ENTRY], stats: { scanned: 1 } }),
		)
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('ok')
		if (res.status !== 'ok') throw new Error('expected ok')
		expect(res.entries).toHaveLength(1)
		expect(res.stats.scanned).toBe(1)
	})

	// Le schéma normalise ; le runner ne doit pas court-circuiter cette étape.
	it('normalises through the manifest schema', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [VALID_ENTRY], stats: {} }))
		const res = await runScan(client, TARGETS)
		if (res.status !== 'ok') throw new Error('expected ok')
		expect(res.entries[0]?.crc32).toBe('e95a3dd7')
	})

	it('fails cleanly when the box is unreachable', async () => {
		const client = ssh(async () => {
			throw new Error('ECONNREFUSED')
		})
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('failed')
		if (res.status !== 'failed') throw new Error('expected failed')
		expect(res.reason).toContain('ECONNREFUSED')
	})

	it('fails cleanly on output that is not json', async () => {
		const client = ssh(async () => 'python3: command not found')
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('failed')
	})

	it('fails cleanly on truncated json', async () => {
		const client = ssh(async () => '{"entries": [')
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('failed')
	})

	// Une entrée invalide fait rejeter tout le manifeste : c'est le contrat de
	// parseManifest, et il doit remonter comme un échec, pas comme un succès vide.
	it('fails cleanly when the schema rejects an entry', async () => {
		const client = ssh(async () =>
			JSON.stringify({ entries: [{ ...VALID_ENTRY, kind: 'floppy' }], stats: {} }),
		)
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('failed')
	})

	// Un scan de toute la box — 126 systèmes — dépasserait la limite. Mieux vaut
	// un refus lisible qu'un « Unable to exec » du transport.
	it('refuses too many targets instead of letting the transport fail', async () => {
		const many = Array.from({ length: 200 }, (_, i) => ({
			mount: '/recalbox/share/externals/usb0',
			system: `system${i}`,
			romsPath: `/recalbox/share/externals/usb0/recalbox/roms/system${i}`,
		}))
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		const res = await runScan(client, many)
		expect(res.status).toBe('failed')
		if (res.status !== 'failed') throw new Error('expected failed')
		expect(res.reason).toContain('too many targets')
		expect(client.exec).not.toHaveBeenCalled()
	})

	it('accepts an empty scan', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: { scanned: 0 } }))
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('ok')
	})

	it('never throws', async () => {
		for (const output of ['', 'null', '[]', '{"entries": null}']) {
			const client = ssh(async () => output)
			await expect(runScan(client, TARGETS)).resolves.toBeDefined()
		}
	})
})

describe('runScanBatched', () => {
	function targetsFor(count: number): ScanTarget[] {
		return Array.from({ length: count }, (_, i) => ({
			mount: '/recalbox/share/externals/usb0',
			system: `system${i}`,
			romsPath: `/recalbox/share/externals/usb0/recalbox/roms/system${i}`,
		}))
	}

	it('runs several commands and reports each batch as it completes', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: { scanned: 3 } }))
		const events: string[][] = []
		const summary = await runScanBatched(client, targetsFor(200), (e) => {
			events.push(e.systems)
		})
		expect(summary.batches).toBeGreaterThan(1)
		expect(client.exec.mock.calls.length).toBe(summary.batches)
		expect(events.flat()).toHaveLength(200)
		expect(summary.failedSystems).toEqual([])
	})

	it('hands the caller the entries of each batch', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [VALID_ENTRY], stats: {} }))
		const seen: number[] = []
		await runScanBatched(client, targetsFor(2), (e) => {
			if (e.type === 'batch-ok') seen.push(e.entries.length)
		})
		expect(seen).toEqual([1])
	})

	// A 17-minute scan must not be thrown away because its last batch failed —
	// but the systems of the failed batch must NOT be reported as scanned, or
	// they would persist as "everything missing".
	it('keeps going after a failed batch and names its systems', async () => {
		let call = 0
		const client = ssh(async () => {
			call++
			if (call === 2) throw new Error('ECONNRESET')
			return JSON.stringify({ entries: [], stats: {} })
		})
		const ok: string[] = []
		const failed: string[] = []
		const summary = await runScanBatched(client, targetsFor(200), (e) => {
			if (e.type === 'batch-ok') ok.push(...e.systems)
			else failed.push(...e.systems)
		})
		expect(failed.length).toBeGreaterThan(0)
		expect(summary.failedSystems).toEqual(failed)
		expect(ok.some((s) => failed.includes(s))).toBe(false)
	})

	it('surfaces systems too large to batch without running them', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		const huge = {
			mount: '/recalbox/share',
			system: 'huge',
			romsPath: `/recalbox/share/roms/${'x'.repeat(9000)}`,
		}
		const summary = await runScanBatched(client, [huge], () => {})
		expect(summary.oversized).toEqual(['huge'])
		expect(client.exec).not.toHaveBeenCalled()
	})

	it('never throws when the callback itself throws', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		await expect(
			runScanBatched(client, targetsFor(2), () => {
				throw new Error('persist failed')
			}),
		).resolves.toBeDefined()
	})
})

describe('runScan (incremental cache)', () => {
	const CACHE: ScanCache = {
		'/recalbox/share/roms/snes/Game.sfc': {
			size: 1048576,
			mtime: 1721900000,
			crc32: 'e95a3dd7',
			kind: 'raw',
		},
	}

	it('sends the cache ahead of the script, on the same stdin', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		await runScan(client, TARGETS, CACHE)
		const stdin = client.exec.mock.calls[0]?.[1]?.stdin ?? ''
		expect(stdin.startsWith('CACHE_B64 = ')).toBe(true)
		expect(stdin).toContain('#!/usr/bin/env python3')
	})

	// The 8000-byte budget is the command line's. The cache rides on stdin,
	// measured up to 2,3 MB on the reference box.
	it('leaves the command line untouched', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		await runScan(client, TARGETS, CACHE)
		const [cmd] = client.exec.mock.calls[0] ?? []
		expect(cmd?.length ?? 0).toBeLessThan(8000)
		expect(cmd).not.toContain('CACHE_B64')
	})

	it('sends the bare script when there is no cache', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		await runScan(client, TARGETS)
		const stdin = client.exec.mock.calls[0]?.[1]?.stdin ?? ''
		expect(stdin.startsWith('#!/usr/bin/env python3')).toBe(true)
	})

	it('sends the bare script rather than an empty assignment for an empty cache', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		await runScan(client, TARGETS, {})
		const stdin = client.exec.mock.calls[0]?.[1]?.stdin ?? ''
		expect(stdin.startsWith('#!/usr/bin/env python3')).toBe(true)
	})

	// A cache is an optimisation: if it cannot be sent, the scan still runs.
	it('drops an oversized cache instead of failing the scan', async () => {
		const huge: ScanCache = {}
		for (let i = 0; i < 400_000; i++) {
			huge[`/${Math.random().toString(36)}/${i}/${Math.random().toString(36)}.zip`] = {
				size: i,
				mtime: i,
				crc32: 'aabbccdd',
				kind: 'container',
			}
		}
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		const res = await runScan(client, TARGETS, huge)
		expect(res.status).toBe('ok')
		const stdin = client.exec.mock.calls[0]?.[1]?.stdin ?? ''
		expect(stdin.startsWith('#!/usr/bin/env python3')).toBe(true)
	})
})
