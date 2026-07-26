import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const getScan = vi.fn()
const getSystemAudit = vi.fn()
const appendSystemRomFiles = vi.fn()
const pruneRomFilesBefore = vi.fn()
const upsertSystemAudit = vi.fn()
const updateScanProgress = vi.fn()
const finishScan = vi.fn()
const loadDatForSystem = vi.fn()
const serverless = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/db/rom-audit-queries', () => ({
	getScan: (...a: unknown[]) => getScan(...a),
	getSystemAudit: (...a: unknown[]) => getSystemAudit(...a),
	appendSystemRomFiles: (...a: unknown[]) => appendSystemRomFiles(...a),
	pruneRomFilesBefore: (...a: unknown[]) => pruneRomFilesBefore(...a),
	upsertSystemAudit: (...a: unknown[]) => upsertSystemAudit(...a),
	updateScanProgress: (...a: unknown[]) => updateScanProgress(...a),
	finishScan: (...a: unknown[]) => finishScan(...a),
	entryKey: (path: string, inner?: string | null) => (inner ? `${path}#${inner}` : path),
}))
vi.mock('@/lib/rom-audit/catalog', () => ({
	loadDatForSystem: (...a: unknown[]) => loadDatForSystem(...a),
}))
vi.mock('@/lib/serverless', () => ({ isServerlessMode: () => serverless() }))

import { POST } from '../route'

const DAT = {
	name: 'Sega - Game Gear',
	version: '2026.05.02',
	games: [
		{ name: 'Game (Europe)', roms: [{ name: 'Game (Europe).gg', size: 1024, crc: 'e95a3dd7' }] },
		{ name: 'Other (Europe)', roms: [{ name: 'Other (Europe).gg', size: 512, crc: 'aabbccdd' }] },
	],
}

const ENTRY = {
	path: '/recalbox/share/roms/gamegear/Game.zip',
	size: 1024,
	mtime: 1721900000,
	system: 'gamegear',
	mount: '/recalbox/share',
	kind: 'zip-entry',
	crc32: 'E95A3DD7',
	innerName: 'Game (Europe).gg',
}

function req(body: unknown, token = 'tok') {
	return {
		headers: {
			get: (k: string) => (k.toLowerCase() === 'authorization' ? `Bearer ${token}` : null),
		},
		json: async () => body,
	} as never
}

function payload(over: Record<string, unknown> = {}) {
	return {
		scan_id: 's1',
		system: 'gamegear',
		mounts: ['/recalbox/share'],
		entries: [ENTRY],
		...over,
	}
}

afterEach(() => {
	for (const m of [
		resolveAgentToken,
		getScan,
		getSystemAudit,
		appendSystemRomFiles,
		pruneRomFilesBefore,
		upsertSystemAudit,
		updateScanProgress,
		finishScan,
		loadDatForSystem,
		serverless,
	]) {
		m.mockReset()
	}
	serverless.mockReturnValue(true)
	pruneRomFilesBefore.mockResolvedValue({ deleted: 0 })
	appendSystemRomFiles.mockResolvedValue({ written: 0 })
})

describe('POST /api/agent/rom-scan', () => {
	function authed() {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb-1' })
		getScan.mockResolvedValue({ id: 's1', recalboxId: 'rb-1', status: 'pending' })
		loadDatForSystem.mockResolvedValue({ status: 'ok', dat: DAT })
		getSystemAudit.mockResolvedValue(null)
	}

	it('401s without a bearer token', async () => {
		const res = await POST({ headers: { get: () => null }, json: async () => ({}) } as never)
		expect(res.status).toBe(401)
	})

	it('401s on an unknown token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		expect((await POST(req(payload()))).status).toBe(401)
	})

	it('400s on a malformed payload', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb-1' })
		expect((await POST(req({ scan_id: 's1' }))).status).toBe(400)
	})

	// The token decides which box this is; the body must never be able to feed
	// another Recalbox's scan.
	it('404s when the scan belongs to another Recalbox', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb-1' })
		getScan.mockResolvedValue({ id: 's1', recalboxId: 'rb-2' })
		const res = await POST(req(payload()))
		expect(res.status).toBe(404)
		expect(appendSystemRomFiles).not.toHaveBeenCalled()
	})

	it('audits the chunk and stores the aggregate', async () => {
		authed()
		const res = await POST(req(payload()))
		expect(res.status).toBe(201)
		expect(await res.json()).toMatchObject({ ok: true, system: 'gamegear', accepted: 1 })

		const row = upsertSystemAudit.mock.calls[0]?.[1]
		expect(row.verifiedCount).toBe(1)
		expect(row.matchedEntries).toEqual(['Game (Europe)'])
		expect(row.totalRomEntries).toBe(2)
	})

	// Serverless keeps aggregates only: the matched files must not be stored.
	it('stores no matched file row in the cloud', async () => {
		authed()
		await POST(req(payload()))
		expect(appendSystemRomFiles.mock.calls[0]?.[3]).toEqual([])
	})

	it('stores the unknown files even in the cloud', async () => {
		authed()
		await POST(req(payload({ entries: [{ ...ENTRY, crc32: '00000000', innerName: 'Nope.gg' }] })))
		const rows = appendSystemRomFiles.mock.calls[0]?.[3]
		expect(rows).toHaveLength(1)
		expect(rows[0].matchLevel).toBe('unknown')
	})

	it('drops an invalid entry and reports it without failing', async () => {
		authed()
		const res = await POST(req(payload({ entries: [ENTRY, { ...ENTRY, kind: 'floppy' }] })))
		expect(res.status).toBe(201)
		expect(await res.json()).toMatchObject({ accepted: 1, rejected: 1 })
	})

	it('accumulates onto the previous chunk instead of replacing it', async () => {
		authed()
		getSystemAudit.mockResolvedValue({
			recalboxId: 'rb-1',
			system: 'gamegear',
			datName: 'Sega - Game Gear',
			datVersion: '2026.05.02',
			totalRomEntries: 2,
			matchedRomEntries: 1,
			verifiedCount: 1,
			serialCount: 0,
			namedCount: 0,
			unknownCount: 0,
			filesScanned: 1,
			totalBytes: 10,
			mounts: ['/recalbox/share'],
			matchedEntries: ['Other (Europe)'],
			scannedAt: new Date('2026-07-26T09:00:00Z'),
		})
		await POST(req(payload({ chunk_index: 1 })))
		const row = upsertSystemAudit.mock.calls[0]?.[1]
		expect(row.verifiedCount).toBe(2)
		expect(row.matchedEntries).toEqual(['Game (Europe)', 'Other (Europe)'])
	})

	// The sweep must use the first chunk's timestamp, or it would delete the rows
	// the earlier chunks of this very scan just wrote.
	it('sweeps from the first chunk of the scan, not from this one', async () => {
		authed()
		const firstChunkAt = new Date('2026-07-26T09:00:00Z')
		getSystemAudit.mockResolvedValue({
			recalboxId: 'rb-1',
			system: 'gamegear',
			datName: null,
			datVersion: null,
			totalRomEntries: 0,
			matchedRomEntries: 0,
			verifiedCount: 0,
			serialCount: 0,
			namedCount: 0,
			unknownCount: 0,
			filesScanned: 0,
			totalBytes: 0,
			mounts: [],
			matchedEntries: [],
			scannedAt: firstChunkAt,
		})
		await POST(req(payload({ chunk_index: 2, last_chunk: true })))
		expect(pruneRomFilesBefore).toHaveBeenCalledWith({}, 'rb-1', 'gamegear', firstChunkAt)
	})

	it('does not sweep on an intermediate chunk', async () => {
		authed()
		await POST(req(payload({ chunk_index: 0, last_chunk: false })))
		expect(pruneRomFilesBefore).not.toHaveBeenCalled()
	})

	it('closes the scan on the final chunk only', async () => {
		authed()
		await POST(req(payload()))
		expect(finishScan).not.toHaveBeenCalled()
		await POST(req(payload({ final: true })))
		expect(finishScan).toHaveBeenCalledWith({}, 's1', 'done')
	})

	it('reports progress with the counts the box provided', async () => {
		authed()
		await POST(req(payload({ systems_done: 3, systems_total: 12 })))
		expect(updateScanProgress).toHaveBeenCalledWith({}, 's1', {
			systemsDone: 3,
			systemsTotal: 12,
			currentSystem: 'gamegear',
		})
	})

	// A transient catalogue failure must not blank a previously good audit.
	it('503s without persisting when the catalogue cannot be downloaded', async () => {
		authed()
		loadDatForSystem.mockResolvedValue({ status: 'unavailable' })
		const res = await POST(req(payload()))
		expect(res.status).toBe(503)
		expect(upsertSystemAudit).not.toHaveBeenCalled()
		expect(appendSystemRomFiles).not.toHaveBeenCalled()
	})

	it('accepts a system with no catalogue as inventory only', async () => {
		authed()
		loadDatForSystem.mockResolvedValue({ status: 'no-catalog' })
		const res = await POST(req(payload()))
		expect(res.status).toBe(201)
		const row = upsertSystemAudit.mock.calls[0]?.[1]
		expect(row.totalRomEntries).toBe(0)
		expect(row.unknownCount).toBe(1)
	})

	it('500s without crashing when persistence blows up', async () => {
		authed()
		appendSystemRomFiles.mockRejectedValue(new Error('database is locked'))
		expect((await POST(req(payload()))).status).toBe(500)
	})
})
