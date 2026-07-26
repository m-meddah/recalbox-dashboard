import type { StorageMount } from '@/lib/recalbox/storage'

export type ScanTarget = { mount: string; system: string; romsPath: string }

/**
 * Root ROMs directory for a support. Recalbox intercalates its own
 * `recalbox` directory on external disks (anything under `/externals/`),
 * but not on the sd card, where roms sit directly under the mount.
 */
export function romsRootFor(mount: string): string {
	const isExternal = mount.includes('/externals/')
	return isExternal ? `${mount}/recalbox/roms` : `${mount}/roms`
}

/**
 * One scan target per system directory, across every mount. Does not
 * require a gamelist.xml — an unscraped-but-populated directory is
 * precisely the kind of thing the audit exists to reveal.
 */
export function buildScanTargets(
	mounts: StorageMount[],
	dirsByRoot: Record<string, string[]>,
): ScanTarget[] {
	const targets: ScanTarget[] = []
	for (const { mount } of mounts) {
		const root = romsRootFor(mount)
		const dirs = dirsByRoot[root]
		if (!dirs) continue
		for (const dir of dirs) {
			if (dir.startsWith('.') || dir === 'ports') continue
			targets.push({ mount, system: dir, romsPath: `${root}/${dir}` })
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
