import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { type ScanTarget, buildScanTargets, romsRootFor } from './scan-targets'

/** Lists the entries of a directory on the box. Injected: SSH here, the CLI's own client there. */
export type ListDirs = (root: string) => Promise<string[]>

export type Discovery = {
	targets: ScanTarget[]
	/** Supports the Web Manager reported. Zero means the box answered nothing. */
	mounts: number
	/** Shares whose listing threw — an SSH failure, a permission problem, a dead disk. */
	unreadable: string[]
	/** The first listing error, kept so the caller can say what actually went wrong. */
	error?: string
}

/**
 * Every `/roms` directory of every share, as scan targets.
 *
 * Supports come from the Web Manager (`fetchStorageInfo`), not from a hardcoded
 * path list: `lib/recalbox/systems.ts` only ever looked at
 * `/recalbox/share/externals/usb*` and therefore ignored the SD card entirely.
 *
 * A share whose listing fails is skipped, not fatal — one unreadable disk must
 * not cost the audit of the others. But the failures are REPORTED rather than
 * swallowed: an SSH login that fails yields zero targets, and answering "no
 * scannable directory" to that sends the user hunting for a collection problem
 * they do not have. Found by running the dev server against a box whose stored
 * password was empty.
 */
export async function discoverScanTargets(
	host: string,
	listDirs: ListDirs,
	systems?: readonly string[],
): Promise<Discovery> {
	const mounts = await fetchStorageInfo(host)
	if (mounts.length === 0) return { targets: [], mounts: 0, unreadable: [] }

	const dirsByRoot: Record<string, string[]> = {}
	const unreadable: string[] = []
	let error: string | undefined

	for (const { mount } of mounts) {
		const root = romsRootFor(mount)
		if (dirsByRoot[root]) continue
		try {
			dirsByRoot[root] = await listDirs(root)
		} catch (err) {
			unreadable.push(root)
			error ??= String(err)
		}
	}

	const all = buildScanTargets(mounts, dirsByRoot)
	const targets =
		!systems || systems.length === 0 ? all : all.filter((t) => new Set(systems).has(t.system))

	return { targets, mounts: mounts.length, unreadable, error }
}
