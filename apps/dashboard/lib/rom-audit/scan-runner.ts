import { logger } from '@/lib/logger'
import { type ManifestEntry, parseManifest } from './manifest'
import { MAX_COMMAND_BYTES, buildScanCommand, planScanBatches } from './scan-batches'
import { type ScanCache, encodeScanCache, withScanCache } from './scan-cache'
import { SCAN_SCRIPT } from './scan-script'
import type { ScanTarget } from './scan-targets'

// A full scan walks hundreds of thousands of files across USB disks. The pool's
// default exec timeout is measured in seconds and would cut it off immediately.
const SCAN_TIMEOUT_MS = 60 * 60 * 1000

// The command budget and the command builder live with the batch planner, which
// packs against them; re-exported here because this module is the transport's
// public face.
export { MAX_COMMAND_BYTES, buildScanCommand }

/**
 * The scan needs to push the script over the exec's stdin, which the pool's
 * plain `SshClientLike` cannot do — so it asks for exactly what it needs.
 * Plan 2B's SSH transport has to provide this, not just `exec(cmd)`.
 */
export type ScanExecutor = {
	exec: (command: string, options: { stdin: string; timeoutMs: number }) => Promise<string>
}

export type ScanOutcome =
	| { status: 'ok'; entries: ManifestEntry[]; stats: Record<string, number> }
	| { status: 'failed'; reason: string }

/** Top-level numeric counters only — the script also nests per-strategy objects. */
function numericStats(raw: unknown): Record<string, number> {
	const out: Record<string, number> = {}
	if (raw && typeof raw === 'object') {
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
		}
	}
	return out
}

/**
 * Builds the program pushed on stdin: the scan script, optionally preceded by
 * the incremental cache.
 *
 * A cache is an optimisation, never a requirement — if it is too large to send,
 * the scan runs without it and re-reads the files rather than failing.
 */
function scanProgram(cache?: ScanCache): string {
	if (!cache || Object.keys(cache).length === 0) return SCAN_SCRIPT
	const encoded = encodeScanCache(cache)
	if (encoded.status !== 'ok') {
		logger.warn(`[rom-audit] scan cache too large (${encoded.bytes} bytes), scanning without it`)
		return SCAN_SCRIPT
	}
	return withScanCache(SCAN_SCRIPT, encoded.payload)
}

/**
 * Runs the scan and validates what comes back.
 *
 * Never throws. A scan is a long operation on modest hardware, reached over a
 * flaky link — an unreachable box, truncated output, invalid JSON or a manifest
 * the schema rejects all come back as a readable failure, never as an
 * exception and never as a silently empty success.
 */
export async function runScan(
	ssh: ScanExecutor,
	targets: readonly ScanTarget[],
	cache?: ScanCache,
): Promise<ScanOutcome> {
	const command = buildScanCommand(targets)
	if (command.length > MAX_COMMAND_BYTES) {
		return {
			status: 'failed',
			reason:
				`too many targets for one scan: the command would be ${command.length} bytes, ` +
				`over the ${MAX_COMMAND_BYTES} the ssh exec can carry. Scan fewer systems per call.`,
		}
	}

	let output: string
	try {
		output = await ssh.exec(command, { stdin: scanProgram(cache), timeoutMs: SCAN_TIMEOUT_MS })
	} catch (err) {
		return { status: 'failed', reason: `scan command failed: ${String(err)}` }
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(output)
	} catch (err) {
		const head = output.slice(0, 200).trim()
		return { status: 'failed', reason: `scan output is not json (${String(err)}): ${head}` }
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { status: 'failed', reason: 'scan output is not a manifest object' }
	}
	const body = parsed as { entries?: unknown; stats?: unknown }
	if (!Array.isArray(body.entries)) {
		return { status: 'failed', reason: 'scan output carries no entries array' }
	}

	try {
		return { status: 'ok', entries: parseManifest(body.entries), stats: numericStats(body.stats) }
	} catch (err) {
		return { status: 'failed', reason: `manifest rejected by the schema: ${String(err)}` }
	}
}

export type ScanBatchEvent =
	| { type: 'batch-ok'; systems: string[]; entries: ManifestEntry[]; stats: Record<string, number> }
	| { type: 'batch-failed'; systems: string[]; reason: string }

export type BatchedScanSummary = { batches: number; failedSystems: string[]; oversized: string[] }

/**
 * Scan any number of systems, in as many commands as the exec limit requires.
 *
 * Results are handed over batch by batch rather than accumulated: a whole-box
 * scan runs for a quarter of an hour, and the caller persists each batch as it
 * lands so a late failure cannot throw away everything before it.
 *
 * A failed batch does NOT abort the run — the other systems are still worth
 * scanning — but its systems are reported as failed and never as scanned. That
 * distinction matters: a system persisted from a failed batch would look like a
 * collection where everything is missing.
 *
 * Never throws, not even when the caller's own callback does.
 */
export async function runScanBatched(
	ssh: ScanExecutor,
	targets: readonly ScanTarget[],
	onBatch: (event: ScanBatchEvent) => Promise<void> | void,
	/** Looked up per system: sending the whole box's cache to every batch would waste the trip. */
	cacheFor?: (systems: readonly string[]) => ScanCache | undefined,
): Promise<BatchedScanSummary> {
	const plan = planScanBatches(targets)
	const failedSystems: string[] = []

	for (const batch of plan.batches) {
		const outcome = await runScan(ssh, batch.targets, cacheFor?.(batch.systems))
		const event: ScanBatchEvent =
			outcome.status === 'ok'
				? {
						type: 'batch-ok',
						systems: batch.systems,
						entries: outcome.entries,
						stats: outcome.stats,
					}
				: { type: 'batch-failed', systems: batch.systems, reason: outcome.reason }

		if (event.type === 'batch-failed') failedSystems.push(...batch.systems)

		try {
			await onBatch(event)
		} catch {
			// The caller's persistence is its own business; a failure there must not
			// abort a scan that may still have a dozen systems to walk.
		}
	}

	return { batches: plan.batches.length, failedSystems, oversized: plan.oversized }
}
