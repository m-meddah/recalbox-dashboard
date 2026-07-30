import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** The only tree a verification may ever read from on the box. */
export const SHARE_ROOT = '/recalbox/share'

export type FetchOutcome =
	| { status: 'ok'; localPath: string; cleanup: () => Promise<void> }
	| { status: 'rejected'; reason: string }
	| { status: 'failed'; reason: string }

export type Downloader = (remotePath: string, localPath: string) => Promise<void>

/**
 * The path comes from `rom_files`, which the box itself filled in. It is still
 * treated as untrusted: it reaches a download call and a process argument, and a
 * row can outlive the collection it described.
 */
export function isVerifiablePath(remotePath: string): boolean {
	if (!remotePath.startsWith(`${SHARE_ROOT}/`)) return false
	if (remotePath.split('/').includes('..')) return false
	// Any C0 control character, null byte and newlines included — spelled out
	// rather than as a character range, which reads as a typo.
	for (let i = 0; i < remotePath.length; i++) {
		if (remotePath.charCodeAt(i) <= 0x1f) return false
	}
	return true
}

/**
 * Brings one title to the host for verification.
 *
 * Downloads into a private temp directory outside the project, and hands back
 * the cleanup so the caller can run it in a `finally`. A few GB per verification
 * fills a disk in a handful of attempts, so the copy never outlives the check.
 *
 * No extraction happens anywhere in the flow: `chdman verify` and
 * `dolphin-tool verify` both stream, so there is no second temporary file and
 * nothing to size a free-space check against.
 */
export async function fetchForVerify(
	remotePath: string,
	download: Downloader,
): Promise<FetchOutcome> {
	if (!isVerifiablePath(remotePath)) {
		return { status: 'rejected', reason: `path outside ${SHARE_ROOT}: ${remotePath}` }
	}

	let dir: string
	try {
		dir = await mkdtemp(path.join(tmpdir(), 'rom-verify-'))
	} catch (err) {
		return { status: 'failed', reason: `cannot create a temp dir: ${String(err)}` }
	}

	const localPath = path.join(dir, path.basename(remotePath))
	const cleanup = async () => {
		await rm(dir, { recursive: true, force: true }).catch(() => {})
	}

	try {
		await download(remotePath, localPath)
	} catch (err) {
		await cleanup()
		return { status: 'failed', reason: `download failed: ${String(err)}` }
	}

	return { status: 'ok', localPath, cleanup }
}
