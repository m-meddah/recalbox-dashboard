import { shellQuote } from '@/lib/recalbox/shell'
import type { SshClientLike } from '@/lib/recalbox/ssh-client'
import { type ManifestEntry, parseManifest } from './manifest'
import { SCAN_SCRIPT } from './scan-script'
import type { ScanTarget } from './scan-targets'

// A full scan walks hundreds of thousands of files across USB disks. The pool's
// default exec timeout is measured in seconds and would cut it off immediately.
const SCAN_TIMEOUT_MS = 60 * 60 * 1000

export type ScanOutcome =
	| { status: 'ok'; entries: ManifestEntry[]; stats: Record<string, number> }
	| { status: 'failed'; reason: string }

/**
 * The command that runs the scan on the box.
 *
 * The script travels over stdin instead of being written to disk: this lot is
 * read-only and must leave nothing behind on the Recalbox. It is base64-encoded
 * so it crosses the shell intact — a heredoc mangles the newlines and Python
 * receives them literally.
 */
export function buildScanCommand(targets: readonly ScanTarget[]): string {
	const script = Buffer.from(SCAN_SCRIPT, 'utf-8').toString('base64')
	// Target paths come from a directory listing on the box: spaces, quotes and
	// parentheses are all routine.
	const args = targets
		.map((t) => `--target ${shellQuote(`${t.mount}|${t.system}|${t.romsPath}`)}`)
		.join(' ')
	return `echo ${script} | base64 -d | python3 - ${args}`
}

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
 * Runs the scan and validates what comes back.
 *
 * Never throws. A scan is a long operation on modest hardware, reached over a
 * flaky link — an unreachable box, truncated output, invalid JSON or a manifest
 * the schema rejects all come back as a readable failure, never as an
 * exception and never as a silently empty success.
 */
export async function runScan(
	ssh: SshClientLike,
	targets: readonly ScanTarget[],
): Promise<ScanOutcome> {
	let output: string
	try {
		output = await ssh.exec(buildScanCommand(targets), SCAN_TIMEOUT_MS)
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
