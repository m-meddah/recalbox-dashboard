import { shellQuote } from '@/lib/recalbox/shell'
import type { ScanTarget } from './scan-targets'

export type ScanBatch = { systems: string[]; targets: ScanTarget[] }
export type BatchPlan = { batches: ScanBatch[]; oversized: string[] }

// Measured on the reference box: an SSH exec fails somewhere between 8 and 16 KB
// of command line, and a 32 KB one drops the connection. Refuse well before that
// rather than surfacing a bare "Unable to exec".
export const MAX_COMMAND_BYTES = 8000

/**
 * The command that runs the scan on the box. The script itself does NOT travel
 * in here — it goes over stdin (see `runScan`).
 *
 * The script is 21 KB, well past the limit above, so inlining it — base64-encoded
 * or otherwise — cannot work. Keep this command small.
 *
 * Nothing is written to the Recalbox either way: this lot is read-only.
 */
export function buildScanCommand(targets: readonly ScanTarget[]): string {
	// Target paths come from a directory listing on the box: spaces, quotes and
	// parentheses are all routine.
	const args = targets
		.map((t) => {
			// The mode is only ever appended when it differs from the script's
			// default: every byte here counts against the 8000-byte budget.
			const spec = `${t.mount}|${t.system}|${t.romsPath}`
			return `--target ${shellQuote(t.hashMode === 'container' ? `${spec}|container` : spec)}`
		})
		.join(' ')
	return `python3 - ${args}`
}

/**
 * Pack scan targets into commands the SSH exec can actually carry.
 *
 * Two invariants, both load-bearing:
 *
 * - **A system is never split across two batches.** Its targets are audited
 *   together against one DAT; halving them would produce two partial audits of
 *   the same system, each looking like a mostly-missing collection.
 * - **A batch's real command is measured, never estimated.** `buildScanCommand`
 *   is what the transport will run, so it is what decides whether a batch fits.
 *
 * A system whose own targets exceed the budget cannot be scanned at all; it is
 * reported in `oversized` rather than dropped or packed into a doomed batch.
 */
export function planScanBatches(
	targets: readonly ScanTarget[],
	maxCommandBytes: number = MAX_COMMAND_BYTES,
): BatchPlan {
	const bySystem = new Map<string, ScanTarget[]>()
	for (const target of targets) {
		const list = bySystem.get(target.system)
		if (list) list.push(target)
		else bySystem.set(target.system, [target])
	}

	const systems = [...bySystem.keys()].sort()
	const batches: ScanBatch[] = []
	const oversized: string[] = []
	let current: ScanBatch | null = null

	for (const system of systems) {
		const systemTargets = bySystem.get(system) ?? []
		if (buildScanCommand(systemTargets).length > maxCommandBytes) {
			oversized.push(system)
			continue
		}

		const merged = current ? [...current.targets, ...systemTargets] : systemTargets
		if (current && buildScanCommand(merged).length <= maxCommandBytes) {
			current.systems.push(system)
			current.targets = merged
			continue
		}

		current = { systems: [system], targets: systemTargets }
		batches.push(current)
	}

	return { batches, oversized }
}
