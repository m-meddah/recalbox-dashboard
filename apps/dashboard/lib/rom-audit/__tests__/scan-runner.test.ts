import { describe, expect, it, vi } from 'vitest'
import { buildScanCommand, runScan } from '../scan-runner'
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

function ssh(exec: (cmd: string) => Promise<string>) {
	return { exec: vi.fn(exec) }
}

describe('buildScanCommand', () => {
	it('feeds the script over stdin rather than writing it to the box', () => {
		const cmd = buildScanCommand(TARGETS)
		expect(cmd).toContain('base64 -d')
		expect(cmd).toContain('python3')
		// Rien ne doit subsister sur la Recalbox : ce lot est en lecture seule.
		expect(cmd).not.toMatch(/>\s*\/recalbox/)
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
