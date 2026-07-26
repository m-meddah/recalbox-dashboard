import type { CatalogResult } from './catalog'
import type { ManifestEntry } from './manifest'
import { type AuditResult, auditSystem } from './match'
import type { ScanCache } from './scan-cache'
import { type ScanExecutor, runScanBatched } from './scan-runner'
import type { ScanTarget } from './scan-targets'

export type AuditPersist = (
	system: string,
	result: AuditResult,
	mounts: string[],
) => Promise<void> | void

export type AuditDeps = {
	loadDat: (system: string) => Promise<CatalogResult>
	persist: AuditPersist
	onProgress: (done: number, total: number, current: string | null) => Promise<void> | void
	/**
	 * The previous scan of the systems in a batch, so the box can skip re-reading
	 * files that have not moved. Optional: without it every file is read again,
	 * which is correct, just slower.
	 */
	cacheFor?: (systems: readonly string[]) => ScanCache | undefined
}

export type AuditRunSummary = {
	systemsAudited: number
	systemsWithoutCatalog: string[]
	failedSystems: string[]
	oversized: string[]
}

/**
 * A system with no reference catalogue is inventory-only: every file is listed,
 * nothing is matched, and the completion metric is meaningless rather than zero.
 * 23 of the 78 known systems are permanently in this state.
 */
function inventoryOnly(system: string, entries: ManifestEntry[]): AuditResult {
	return {
		system,
		datName: '',
		datVersion: '',
		totalRomEntries: 0,
		matchedRomEntries: 0,
		files: entries.map((entry) => ({ ...entry, matchLevel: 'unknown' as const })),
		games: [],
		missingGames: [],
	}
}

/**
 * Scan a set of targets and audit each system as its batch comes back.
 *
 * Persistence happens system by system, mid-scan: a whole-box scan runs for a
 * quarter of an hour, and everything already audited must survive a failure that
 * happens later. The counterpart is that a system is persisted only when its
 * scan AND its catalogue both succeeded — a system persisted from a failed scan,
 * or against a catalogue that failed to download, would come back with an empty
 * matched set and read as "nothing owned", silently destroying the previous
 * audit.
 *
 * Never throws: an unreachable box, an unreadable catalogue or a failing
 * database all end up in the summary.
 */
export async function runAuditOverScan(
	ssh: ScanExecutor,
	targets: readonly ScanTarget[],
	deps: AuditDeps,
): Promise<AuditRunSummary> {
	const mountsBySystem = new Map<string, string[]>()
	for (const target of targets) {
		const mounts = mountsBySystem.get(target.system) ?? []
		if (!mounts.includes(target.mount)) mounts.push(target.mount)
		mountsBySystem.set(target.system, mounts)
	}

	const total = mountsBySystem.size
	const systemsWithoutCatalog: string[] = []
	const failedSystems: string[] = []
	let systemsAudited = 0
	let done = 0

	const summary = await runScanBatched(
		ssh,
		targets,
		async (event) => {
			if (event.type === 'batch-failed') {
				failedSystems.push(...event.systems)
				done += event.systems.length
				await deps.onProgress(done, total, null)
				return
			}

			for (const system of event.systems) {
				const entries = event.entries.filter((e) => e.system === system)
				try {
					const catalog = await deps.loadDat(system)
					if (catalog.status === 'unavailable') {
						failedSystems.push(system)
					} else {
						const result =
							catalog.status === 'ok'
								? auditSystem(system, entries, catalog.dat)
								: inventoryOnly(system, entries)
						if (catalog.status === 'no-catalog') systemsWithoutCatalog.push(system)
						await deps.persist(system, result, mountsBySystem.get(system) ?? [])
						systemsAudited++
					}
				} catch {
					// Catalogue read or persistence blew up: this system has no usable
					// result, and the ones after it still deserve their scan.
					failedSystems.push(system)
				}
				done++
				await deps.onProgress(done, total, system)
			}
		},
		deps.cacheFor,
	)

	return { systemsAudited, systemsWithoutCatalog, failedSystems, oversized: summary.oversized }
}
