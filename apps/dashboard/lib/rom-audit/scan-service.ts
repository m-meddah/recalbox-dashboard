import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import type { RomFileRow } from '@/lib/db/rom-audit-queries'
import {
	createScan,
	finishScan,
	listRomFiles,
	syncSystemRomFiles,
	updateScanProgress,
	upsertSystemAudit,
} from '@/lib/db/rom-audit-queries'
import { logger } from '@/lib/logger'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { isServerlessMode } from '@/lib/serverless'
import { loadDatForSystem } from './catalog'
import { discoverScanTargets } from './discover'
import { auditToFileRows, auditToSystemRow, persistPolicyFor } from './persist'
import { runAuditOverScan } from './run-audit'
import { planScanBatches } from './scan-batches'
import { type ScanCache, buildScanCache } from './scan-cache'
import type { ScanExecutor } from './scan-runner'

// The scan holds its SSH connection for as long as it walks the disks — a whole
// box is a quarter of an hour. It gets its own pool variant so it never occupies
// one of the two shared slots the rest of the app executes on.
const SSH_VARIANT = 'rom-scan'

// Listing a share's `/roms` is not a quick command: 126 directories on a USB disk
// that has to spin up took over the pool's 5 s default, which silently dropped
// the ONE support holding the collection — the audit then looked empty rather
// than broken. Found by running the dev server against the real box.
const LIST_TIMEOUT_MS = 60_000

export type StartScanOutcome =
	| { status: 'started'; scanId: string; systemsTotal: number }
	| { status: 'no-targets' }
	/** The box answered, but not one of its shares could be listed. */
	| { status: 'unreachable'; reason: string }

/** Adapts the SSH pool client to the executor the scan needs (stdin + long timeout). */
function executorFor(recalboxId: string): ScanExecutor {
	const client = getSshClient(recalboxId, SSH_VARIANT)
	return {
		exec: (command, options) => client.exec(command, options.timeoutMs, options.stdin),
	}
}

async function listDirsOverSsh(recalboxId: string, root: string): Promise<string[]> {
	const client = getSshClient(recalboxId, SSH_VARIANT)
	const out = await client.exec(
		`ls -1 ${JSON.stringify(root)} 2>/dev/null || true`,
		LIST_TIMEOUT_MS,
	)
	return out
		.split('\n')
		.map((d) => d.trim())
		.filter(Boolean)
}

/**
 * Start a server-driven scan and return as soon as it is recorded.
 *
 * The audit itself runs detached: it lasts minutes, far past any HTTP request.
 * Progress and completion are read back from the `rom_scans` row.
 */
export async function startSelfHostedScan(
	recalboxId: string,
	userId: string | null,
	systems?: readonly string[],
): Promise<StartScanOutcome> {
	const host = configStore.getForRecalbox(recalboxId).recalbox.host
	const discovery = await discoverScanTargets(
		host,
		(root) => listDirsOverSsh(recalboxId, root),
		systems,
	)
	const targets = discovery.targets
	// Every share failing to list is a connection problem, not an empty
	// collection. Saying "no scannable directory" there sends the reader hunting
	// for a collection issue they do not have.
	if (targets.length === 0 && discovery.unreadable.length > 0 && discovery.error) {
		return { status: 'unreachable', reason: discovery.error }
	}
	if (targets.length === 0) return { status: 'no-targets' }

	// A support that could not be listed is missing from the audit entirely. Say so
	// on the scan row: without it, a dropped disk is indistinguishable from a
	// collection that shrank.
	if (discovery.unreadable.length > 0) {
		logger.warn(
			`[rom-audit] scanning without ${discovery.unreadable.length} unreadable share(s): ` +
				`${discovery.unreadable.join(', ')} — ${discovery.error}`,
		)
	}

	const systemsTotal = new Set(targets.map((t) => t.system)).size
	const scan = await createScan(db, recalboxId, 'ssh', systemsTotal, userId)
	const policy = persistPolicyFor(isServerlessMode())

	// The incremental cache is what makes a rescan cheap: without it the box
	// re-reads every bare ROM and every arcade container in full — 57 GB of
	// archives for mame, fbneo and neogeo alone on the reference collection.
	//
	// It is empty in `aggregates` mode by construction: the cloud stores only the
	// `unknown` entries, so there is nothing to hand back. A serverless scan
	// therefore always re-reads. Known limit, recorded in the plan.
	const cacheFor = async (systems: readonly string[]): Promise<ScanCache> => {
		const rows: RomFileRow[] = []
		for (const system of systems) {
			rows.push(...(await listRomFiles(db, recalboxId, system)))
		}
		return buildScanCache(rows)
	}

	// runScanBatched asks synchronously, batch by batch; pre-load each batch's
	// cache on the way in rather than blocking the scan loop on a query.
	const caches = new Map<string, ScanCache>()
	for (const batch of planScanBatches(targets).batches) {
		caches.set(batch.systems.join(','), await cacheFor(batch.systems))
	}

	void runAuditOverScan(executorFor(recalboxId), targets, {
		loadDat: (system) => loadDatForSystem(system),
		persist: async (system, result, mounts) => {
			const scannedAt = new Date()
			await syncSystemRomFiles(
				db,
				recalboxId,
				system,
				auditToFileRows(recalboxId, result, policy, scannedAt),
			)
			await upsertSystemAudit(db, auditToSystemRow(recalboxId, result, mounts, scannedAt))
		},
		cacheFor: (systems) => caches.get(systems.join(',')),
		onProgress: (done, total, current) =>
			updateScanProgress(db, scan.id, {
				systemsDone: done,
				systemsTotal: total,
				currentSystem: current,
			}),
	})
		.then(async (summary) => {
			const failed = [...summary.failedSystems, ...summary.oversized]
			// Some systems failing is a partial success; none succeeding is a failure.
			const status = summary.systemsAudited === 0 && failed.length > 0 ? 'failed' : 'done'
			const notes = [
				failed.length > 0 ? `systems not audited: ${failed.join(', ')}` : null,
				discovery.unreadable.length > 0
					? `shares skipped (unreadable): ${discovery.unreadable.join(', ')}`
					: null,
			].filter(Boolean)
			const error = notes.length > 0 ? notes.join(' | ') : null
			await finishScan(db, scan.id, status, error)
		})
		.catch(async (err) => {
			logger.error('[rom-audit] scan crashed', err)
			await finishScan(db, scan.id, 'failed', String(err)).catch(() => {})
		})

	return { status: 'started', scanId: scan.id, systemsTotal }
}
