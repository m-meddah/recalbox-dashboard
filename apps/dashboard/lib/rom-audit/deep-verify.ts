import type { Dat } from './dat-parser'

/**
 * Deep verification of one title, on the dashboard host.
 *
 * The two tools have **inverted semantics**, measured on real files on
 * 2026-07-27. Treating them alike would be wrong in a way that is invisible:
 *
 * | | integrity verdict | catalogue comparison |
 * |---|---|---|
 * | CHD  | yes — `chdman` exits 1 on a corrupt file | impossible: a CHD merges the
 * |      |                                          | tracks Redump hashes apart |
 * | RVZ  | none — `dolphin-tool` exits 0 and prints | **yes, exact** — its hash is
 * |      | "Problems Found: No" on a corrupt file   | the reconstructed image's, and
 * |      |                                          | that is what Redump catalogues |
 *
 * So a CHD is judged by the tool, and an RVZ by the catalogue. Believing
 * `dolphin-tool`'s exit code would report a corrupted disc as intact.
 */
export type VerifyTool = 'chdman' | 'dolphin-tool'

export type ToolAvailability = { tool: VerifyTool; available: boolean; version?: string }

export type VerifyOutcome =
	/** CHD: chdman recomputed and confirmed the SHA1s stored in its own header. */
	| { status: 'intact'; sha1?: string; rawSha1?: string }
	/** CHD: chdman failed its own check. The file is damaged. */
	| { status: 'corrupt'; detail: string }
	/** RVZ: the reconstructed image's hash matches a catalogue entry. */
	| { status: 'verified'; crc32: string; sha1: string; datEntryName: string }
	/** RVZ: no entry matches — a damaged dump OR one Redump does not list. */
	| { status: 'mismatch'; crc32: string; sha1: string }
	/** RVZ whose system has no catalogue: the hash is computed but uncheckable. */
	| { status: 'no-catalog'; crc32: string; sha1: string }
	| { status: 'unsupported'; reason: string }
	| { status: 'tool-missing'; tool: VerifyTool }
	| { status: 'failed'; reason: string }

export type CommandResult = { code: number; stdout: string; stderr: string }
export type RunCommand = (bin: string, args: string[]) => Promise<CommandResult>

/**
 * `dolphin-tool` ships in `/usr/games`, which is missing from the PATH of many
 * non-interactive contexts. Looking it up with `which` alone is what made an
 * earlier survey conclude it was not packaged at all.
 */
export const TOOL_PATHS: Record<VerifyTool, string[]> = {
	chdman: ['chdman', '/usr/bin/chdman', '/usr/local/bin/chdman'],
	'dolphin-tool': ['dolphin-tool', '/usr/games/dolphin-tool', '/usr/local/bin/dolphin-tool'],
}

const VERSION_LINE = /\b(\d+\.\d+[\w.]*)/

/** Locates a tool, or reports it missing. Never throws: absence is a normal state. */
export async function detectTool(tool: VerifyTool, run: RunCommand): Promise<ToolAvailability> {
	for (const bin of TOOL_PATHS[tool]) {
		try {
			const res = await run(bin, tool === 'chdman' ? [] : ['--help'])
			// Both binaries print their usage banner on a bare invocation; what
			// matters is that the process ran at all, not what it returned.
			const output = `${res.stdout}\n${res.stderr}`
			if (!output.trim()) continue
			return { tool, available: true, version: VERSION_LINE.exec(output)?.[1] }
		} catch {
			// ENOENT on this candidate path — try the next one.
		}
	}
	return { tool, available: false }
}

export async function detectTools(run: RunCommand): Promise<ToolAvailability[]> {
	return Promise.all([detectTool('chdman', run), detectTool('dolphin-tool', run)])
}

const CHD_SHA1 = /^SHA1:\s*([0-9a-f]{40})/im
const CHD_RAW_SHA1 = /^Data SHA1:\s*([0-9a-f]{40})/im
const DOLPHIN_CRC32 = /^CRC32:\s*([0-9a-f]{8})/im
const DOLPHIN_SHA1 = /^SHA1:\s*([0-9a-f]{40})/im

/**
 * A CHD carries the SHA1 of its own contents; `chdman verify` recomputes them
 * and exits non-zero when they disagree. That makes the exit code the verdict —
 * the one case where the tool can judge on its own.
 *
 * A missing file also exits 1, so the two are told apart by the message. Calling
 * a stale path "corrupt" would announce a damaged collection where there is only
 * an outdated row.
 */
export async function verifyChd(localPath: string, run: RunCommand): Promise<VerifyOutcome> {
	let res: CommandResult
	try {
		res = await run('chdman', ['verify', '-i', localPath])
	} catch (err) {
		return { status: 'failed', reason: String(err) }
	}

	const output = `${res.stdout}\n${res.stderr}`
	if (res.code === 0) {
		return {
			status: 'intact',
			sha1: CHD_SHA1.exec(output)?.[1],
			rawSha1: CHD_RAW_SHA1.exec(output)?.[1],
		}
	}
	if (/no such file|cannot open|unable to open/i.test(output)) {
		return { status: 'failed', reason: 'file not readable by chdman' }
	}
	return { status: 'corrupt', detail: output.trim().slice(0, 500) || `chdman exited ${res.code}` }
}

/**
 * An RVZ stores no hash of the full image, so `dolphin-tool` has nothing to
 * check against: it exits 0 and prints "Problems Found: No" even on a file whose
 * data has been altered. Its output is a measurement, never a verdict.
 *
 * The verdict comes from the catalogue instead, and it can be exact: the hash it
 * prints is the reconstructed disc image's, which is precisely what Redump
 * lists for GameCube and Wii.
 */
export async function verifyRvz(
	localPath: string,
	dat: Dat | null,
	run: RunCommand,
): Promise<VerifyOutcome> {
	let res: CommandResult
	try {
		res = await run('dolphin-tool', ['verify', '-i', localPath])
	} catch (err) {
		return { status: 'failed', reason: String(err) }
	}

	const output = `${res.stdout}\n${res.stderr}`
	const crc32 = DOLPHIN_CRC32.exec(output)?.[1]
	const sha1 = DOLPHIN_SHA1.exec(output)?.[1]
	if (!crc32 || !sha1) {
		return {
			status: 'failed',
			reason: res.code === 0 ? 'dolphin-tool printed no hash' : `dolphin-tool exited ${res.code}`,
		}
	}

	if (!dat) return { status: 'no-catalog', crc32, sha1 }

	for (const game of dat.games) {
		for (const rom of game.roms) {
			if (rom.sha1?.toLowerCase() === sha1 || rom.crc?.toLowerCase() === crc32) {
				return { status: 'verified', crc32, sha1, datEntryName: rom.name }
			}
		}
	}
	return { status: 'mismatch', crc32, sha1 }
}
