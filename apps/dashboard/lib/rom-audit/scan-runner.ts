import { shellQuote } from '@/lib/recalbox/shell'
import { type ManifestEntry, parseManifest } from './manifest'
import { SCAN_SCRIPT } from './scan-script'
import type { ScanTarget } from './scan-targets'

// A full scan walks hundreds of thousands of files across USB disks. The pool's
// default exec timeout is measured in seconds and would cut it off immediately.
const SCAN_TIMEOUT_MS = 60 * 60 * 1000

// Measured on the reference box: an SSH exec fails somewhere between 8 and 16 KB
// of command line, and a 32 KB one drops the connection. Refuse well before that
// rather than surfacing a bare "Unable to exec".
const MAX_COMMAND_BYTES = 8000

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

/**
 * The command that runs the scan on the box. The script itself does NOT travel
 * in here — it goes over stdin.
 *
 * Measured on the reference box: an SSH exec command line fails somewhere
 * between 8 and 16 KB, and a 32 KB one drops the connection outright. The
 * script is 21 KB, so inlining it — base64-encoded or otherwise — cannot work.
 * Keep this command small.
 *
 * Nothing is written to the Recalbox either way: this lot is read-only.
 */
export function buildScanCommand(targets: readonly ScanTarget[]): string {
	// Target paths come from a directory listing on the box: spaces, quotes and
	// parentheses are all routine.
	const args = targets
		.map((t) => `--target ${shellQuote(`${t.mount}|${t.system}|${t.romsPath}`)}`)
		.join(' ')
	return `python3 - ${args}`
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
	ssh: ScanExecutor,
	targets: readonly ScanTarget[],
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
		output = await ssh.exec(command, { stdin: SCAN_SCRIPT, timeoutMs: SCAN_TIMEOUT_MS })
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
