import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { type ScanTarget, buildScanTargets, romsRootFor } from './scan-targets'

/** Lists the entries of a directory on the box. Injected: SSH here, the CLI's own client there. */
export type ListDirs = (root: string) => Promise<string[]>

/** Where Recalbox mounts every removable and network support. */
export const EXTERNALS_ROOT = '/recalbox/share/externals'

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
 * Every `/roms` directory of every support, as scan targets.
 *
 * Supports come from TWO sources, deliberately:
 *
 * 1. The Web Manager (`fetchStorageInfo`), which reports the partitions it tags
 *    `share` — the SD card and the USB disks.
 * 2. A direct listing of `/recalbox/share/externals`.
 *
 * The second exists because the first depends on Recalbox's own tagging, and a
 * **NAS mount** (`network0`…`network3`) is not a partition the monitoring API
 * describes the way it describes `/dev/sdb1`. The on-box agent has always
 * enumerated that directory; without this, the SSH transport and the agent would
 * disagree about which supports exist — the SSH one silently ignoring a whole
 * NAS. Enumerating also covers `usb2`/`usb3` and any future naming, since
 * nothing here matches on `usb`.
 *
 * A support whose listing fails is skipped, not fatal — one unreadable disk must
 * not cost the audit of the others. But the failures are REPORTED rather than
 * swallowed: an SSH login that fails yields zero targets, and answering "no
 * scannable directory" to that sends the user hunting for a collection problem
 * they do not have.
 */
export async function discoverScanTargets(
	host: string,
	listDirs: ListDirs,
	systems?: readonly string[],
): Promise<Discovery> {
	const reported = await fetchStorageInfo(host)
	const unreadable: string[] = []
	let error: string | undefined

	const listOrRecord = async (root: string): Promise<string[] | null> => {
		try {
			return await listDirs(root)
		} catch (err) {
			unreadable.push(root)
			error ??= String(err)
			return null
		}
	}

	// Externals the monitoring API did not describe — a NAS above all.
	const extras: { mount: string }[] = []
	const externals = await listOrRecord(EXTERNALS_ROOT)
	for (const entry of externals ?? []) {
		if (entry.startsWith('.')) continue
		extras.push({ mount: `${EXTERNALS_ROOT}/${entry}` })
	}

	const mounts = [...reported.map((m) => ({ mount: m.mount })), ...extras]
	if (mounts.length === 0) return { targets: [], mounts: 0, unreadable, error }

	const dirsByRoot: Record<string, string[]> = {}
	// Attempted, not merely succeeded: a support both sources report resolves to
	// the same root, and retrying a failed listing would list it twice and record
	// the failure twice.
	const attempted = new Set<string>()
	for (const { mount } of mounts) {
		const root = romsRootFor(mount)
		if (attempted.has(root)) continue
		attempted.add(root)
		const dirs = await listOrRecord(root)
		// An external with no `recalbox/roms` is a data disk, not a ROM support:
		// absent, not unreadable, so it must not be reported as a failure.
		if (dirs) dirsByRoot[root] = dirs
	}

	const all = buildScanTargets(mounts, dirsByRoot)
	const targets =
		!systems || systems.length === 0 ? all : all.filter((t) => new Set(systems).has(t.system))

	return { targets, mounts: reported.length, unreadable, error }
}
