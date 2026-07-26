import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { type ScanTarget, buildScanTargets, romsRootFor } from './scan-targets'

/** Lists the entries of a directory on the box. Injected: SSH here, the CLI's own client there. */
export type ListDirs = (root: string) => Promise<string[]>

/**
 * Every `/roms` directory of every share, as scan targets.
 *
 * Supports come from the Web Manager (`fetchStorageInfo`), not from a hardcoded
 * path list: `lib/recalbox/systems.ts` only ever looked at
 * `/recalbox/share/externals/usb*` and therefore ignored the SD card entirely.
 *
 * A share whose listing fails is skipped, not fatal — one unreadable disk must
 * not cost the audit of the others.
 */
export async function discoverScanTargets(
	host: string,
	listDirs: ListDirs,
	systems?: readonly string[],
): Promise<ScanTarget[]> {
	const mounts = await fetchStorageInfo(host)
	if (mounts.length === 0) return []

	const dirsByRoot: Record<string, string[]> = {}
	for (const { mount } of mounts) {
		const root = romsRootFor(mount)
		if (dirsByRoot[root]) continue
		try {
			dirsByRoot[root] = await listDirs(root)
		} catch {
			// Unreadable share: no targets from it, and the scan goes on.
		}
	}

	const all = buildScanTargets(mounts, dirsByRoot)
	if (!systems || systems.length === 0) return all
	const wanted = new Set(systems)
	return all.filter((t) => wanted.has(t.system))
}
