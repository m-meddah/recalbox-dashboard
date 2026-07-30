import { catalogForSystem } from './system-catalog'

export type ScanTarget = {
	mount: string
	system: string
	romsPath: string
	/** Absent means 'content'. Only the arcade systems need 'container'. */
	hashMode?: 'content' | 'container'
}

/**
 * Root ROMs directory for a support. Recalbox intercalates its own
 * `recalbox` directory on external disks (anything under `/externals/`),
 * but not on the sd card, where roms sit directly under the mount.
 */
export function romsRootFor(mount: string): string {
	// A trailing slash would produce `…//recalbox/roms`, which then matches no
	// dirsByRoot key and no scanned path — the whole support would go silently
	// missing from the audit instead of erroring.
	const base = normalizeMount(mount)
	const isExternal = base.includes('/externals/')
	return isExternal ? `${base}/recalbox/roms` : `${base}/roms`
}

/** A mount path without its trailing slashes, so prefixes compare reliably. */
function normalizeMount(mount: string): string {
	return mount.replace(/\/+$/, '')
}

/**
 * One scan target per system directory, across every mount. Does not
 * require a gamelist.xml — an unscraped-but-populated directory is
 * precisely the kind of thing the audit exists to reveal.
 */
export function buildScanTargets(
	// Only the mount path matters here, and the callers now mix Web-Manager
	// partitions with externals enumerated directly on the box (a NAS is not a
	// partition the monitoring API describes).
	mounts: readonly { mount: string }[],
	dirsByRoot: Record<string, string[]>,
): ScanTarget[] {
	const targets: ScanTarget[] = []
	// fetchStorageInfo dedupes by filesystem+size+used, not by mount, so the same
	// mount can still arrive twice — which would scan and count it twice.
	const seen = new Set<string>()
	for (const { mount: raw } of mounts) {
		const mount = normalizeMount(raw)
		if (seen.has(mount)) continue
		seen.add(mount)
		const root = romsRootFor(mount)
		const dirs = dirsByRoot[root]
		if (!dirs) continue
		for (const dir of dirs) {
			if (dir.startsWith('.') || dir === 'ports') continue
			const hashMode = catalogForSystem(dir)?.hashMode
			targets.push({
				mount,
				system: dir,
				romsPath: `${root}/${dir}`,
				...(hashMode === 'container' ? { hashMode } : {}),
			})
		}
	}
	return targets
}

/**
 * Attributes an absolute path to the longest matching mount, so that
 * `/recalbox/share` (a prefix of the external disk mounts) never steals
 * files that actually live under `/recalbox/share/externals/usb0`. A
 * prefix only counts if it stops on a path segment boundary.
 */
export function mountForPath(path: string, mounts: readonly string[]): string | null {
	let best: string | null = null
	for (const m of mounts) {
		if (path !== m && !path.startsWith(`${m}/`)) continue
		if (best === null || m.length > best.length) best = m
	}
	return best
}
