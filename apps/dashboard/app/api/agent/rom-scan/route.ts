import { getAgentVersion, getBearerToken } from '@/lib/agent/bearer'
import { db } from '@/lib/db'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import {
	appendSystemRomFiles,
	finishScan,
	getScan,
	getSystemAudit,
	pruneRomFilesBefore,
	updateScanProgress,
	upsertSystemAudit,
} from '@/lib/db/rom-audit-queries'
import { logger } from '@/lib/logger'
import { loadDatForSystem } from '@/lib/rom-audit/catalog'
import { parseManifestLenient } from '@/lib/rom-audit/manifest'
import { type AuditResult, auditSystem } from '@/lib/rom-audit/match'
import {
	auditToFileRows,
	auditToSystemRow,
	mergeSystemAudit,
	persistPolicyFor,
} from '@/lib/rom-audit/persist'
import { isServerlessMode } from '@/lib/serverless'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One system per request, split into chunks when it is large: psx alone is 7185
 * entries (~1.8 MB of body) on the reference collection, and a MAME-sized system
 * would blow past the cloud's body limit in one piece.
 */
const Payload = z.object({
	scan_id: z.string().min(1).max(64),
	system: z.string().min(1).max(64),
	mounts: z.array(z.string().min(1)).max(16).optional(),
	// Entries are validated one by one below: a single odd entry must not cost
	// the whole system's scan.
	entries: z.array(z.unknown()).max(20000),
	stats: z.record(z.string(), z.number()).optional(),
	// 0 for the first chunk of a system; the aggregate starts fresh there and
	// accumulates on the following ones.
	chunk_index: z.number().int().nonnegative().default(0),
	last_chunk: z.boolean().default(true),
	// True on the very last chunk of the very last system: closes the scan.
	final: z.boolean().default(false),
	// The box knows how many systems it will send; the cloud could not.
	systems_total: z.number().int().nonnegative().optional(),
	systems_done: z.number().int().nonnegative().optional(),
})

/** A system with no reference catalogue is inventory-only, not an error. */
function inventoryOnly(system: string, entries: AuditResult['files']): AuditResult {
	return {
		system,
		datName: '',
		datVersion: '',
		totalRomEntries: 0,
		matchedRomEntries: 0,
		files: entries.map((e) => ({ ...e, matchLevel: 'unknown' as const })),
		games: [],
		missingGames: [],
	}
}

export async function POST(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })

	const resolved = await resolveAgentToken(db, token, getAgentVersion(req))
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	let json: unknown
	try {
		json = await req.json()
	} catch {
		return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
	}

	const parsed = Payload.safeParse(json)
	if (!parsed.success) {
		return NextResponse.json(
			{ error: 'invalid_payload', details: parsed.error.format() },
			{ status: 400 },
		)
	}
	const p = parsed.data

	// An agent may only feed a scan of its own box: the token decides, never the body.
	const scan = await getScan(db, p.scan_id)
	if (!scan || scan.recalboxId !== resolved.recalboxId) {
		return NextResponse.json({ error: 'unknown_scan' }, { status: 404 })
	}

	try {
		const { entries, rejected } = parseManifestLenient(p.entries)
		const catalog = await loadDatForSystem(p.system)
		if (catalog.status === 'unavailable') {
			// Persisting now would blank matchedEntries and read as "nothing owned",
			// destroying a previously good audit over a transient download failure.
			return NextResponse.json({ error: 'catalog_unavailable' }, { status: 503 })
		}

		const result =
			catalog.status === 'ok'
				? auditSystem(p.system, entries, catalog.dat)
				: inventoryOnly(p.system, entries as AuditResult['files'])

		const scannedAt = new Date()
		const policy = persistPolicyFor(isServerlessMode())
		const rows = auditToFileRows(resolved.recalboxId, result, policy, scannedAt)
		await appendSystemRomFiles(db, resolved.recalboxId, p.system, rows)

		const incoming = auditToSystemRow(resolved.recalboxId, result, p.mounts ?? [], scannedAt)
		const previous =
			p.chunk_index > 0 ? await getSystemAudit(db, resolved.recalboxId, p.system) : null
		await upsertSystemAudit(db, previous ? mergeSystemAudit(previous, incoming) : incoming)

		// The sweep closes the system: rows older than this scan's first chunk are
		// files that no longer exist. Deferred to the last chunk because a single
		// chunk cannot tell a vanished file from one belonging to another chunk.
		//
		// The watermark is the aggregate's previous timestamp, i.e. when this scan's
		// FIRST chunk landed — never this chunk's own, which would sweep away the
		// earlier chunks. A mid-sequence chunk that finds no aggregate at all is an
		// inconsistent state: skip the sweep rather than delete what came before.
		let deleted = 0
		if (p.last_chunk && (p.chunk_index === 0 || previous)) {
			const watermark = previous?.scannedAt ?? scannedAt
			deleted = (await pruneRomFilesBefore(db, resolved.recalboxId, p.system, watermark)).deleted
		}

		await updateScanProgress(db, p.scan_id, {
			systemsDone: p.systems_done,
			systemsTotal: p.systems_total,
			currentSystem: p.system,
		})
		if (p.final) await finishScan(db, p.scan_id, 'done')

		return NextResponse.json(
			{ ok: true, system: p.system, accepted: entries.length, rejected, deleted },
			{ status: 201 },
		)
	} catch (e) {
		logger.error('[agent/rom-scan] ingest failed', e)
		return NextResponse.json({ error: 'ingest_failed' }, { status: 500 })
	}
}
