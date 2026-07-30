import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { db } from '@/lib/db'
import type { RomFileRow } from '@/lib/db/rom-audit-queries'
import { getRomFileByKey } from '@/lib/db/rom-audit-queries'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { loadDatForSystem } from './catalog'
import {
	type RunCommand,
	type ToolAvailability,
	type VerifyOutcome,
	type VerifyTool,
	detectTools,
	verifyChd,
	verifyRvz,
} from './deep-verify'
import { fetchForVerify } from './deep-verify-fetch'

const exec = promisify(execFile)

// A verification streams a whole disc image through the tool; on a large DVD
// that is minutes, not seconds.
const TOOL_TIMEOUT_MS = 30 * 60 * 1000

// Its own pool variant: pulling several gigabytes would otherwise hold one of
// the two shared execution slots for the whole transfer.
const SSH_VARIANT = 'rom-verify'

/** Spawns a tool without a shell — arguments never go through one. */
export const runTool: RunCommand = async (bin, args) => {
	try {
		const { stdout, stderr } = await exec(bin, args, {
			maxBuffer: 8 * 1024 * 1024,
			timeout: TOOL_TIMEOUT_MS,
		})
		return { code: 0, stdout, stderr }
	} catch (err) {
		const e = err as { code?: number | string; stdout?: string; stderr?: string }
		// A non-zero exit surfaces as a rejection carrying the output; a spawn
		// failure (ENOENT) carries none and must stay an exception so the tool
		// detection can tell "absent" from "ran and failed".
		if (e.stdout === undefined && e.stderr === undefined) throw err
		return {
			code: typeof e.code === 'number' ? e.code : 1,
			stdout: e.stdout ?? '',
			stderr: e.stderr ?? '',
		}
	}
}

/** Which deep-verify tool a scanned entry needs, if any. */
export function toolForKind(kind: string): VerifyTool | null {
	if (kind === 'chd') return 'chdman'
	if (kind === 'rvz') return 'dolphin-tool'
	return null
}

let toolCache: { at: number; tools: ToolAvailability[] } | null = null
const TOOL_CACHE_MS = 60_000

/** Detected once a minute: spawning two processes on every page render is waste. */
export async function availableTools(run: RunCommand = runTool): Promise<ToolAvailability[]> {
	if (toolCache && Date.now() - toolCache.at < TOOL_CACHE_MS) return toolCache.tools
	const tools = await detectTools(run)
	toolCache = { at: Date.now(), tools }
	return tools
}

export type VerifyDeps = {
	run?: RunCommand
	download?: (remotePath: string, localPath: string) => Promise<void>
	findRow?: (recalboxId: string, entryKey: string) => Promise<RomFileRow | null>
}

/**
 * Verifies one scanned entry, end to end: locate it, bring it over, run its
 * tool, then delete the copy.
 *
 * The copy is removed in a `finally` — several gigabytes per verification fills
 * a disk in a handful of attempts.
 */
export async function verifyEntry(
	recalboxId: string,
	entryKey: string,
	deps: VerifyDeps = {},
): Promise<VerifyOutcome> {
	const run = deps.run ?? runTool
	const findRow = deps.findRow ?? ((rb: string, key: string) => getRomFileByKey(db, rb, key))
	const row = await findRow(recalboxId, entryKey)
	if (!row) return { status: 'failed', reason: 'entry not found' }

	const tool = toolForKind(row.kind)
	if (!tool) {
		return { status: 'unsupported', reason: `nothing to deep-verify for kind "${row.kind}"` }
	}

	const availability = (await availableTools(run)).find((t) => t.tool === tool)
	if (!availability?.available) return { status: 'tool-missing', tool }

	const download =
		deps.download ??
		((remotePath: string, localPath: string) =>
			getSshClient(recalboxId, SSH_VARIANT).getFile(localPath, remotePath))

	const fetched = await fetchForVerify(row.path, download)
	if (fetched.status === 'rejected') return { status: 'unsupported', reason: fetched.reason }
	if (fetched.status === 'failed') return { status: 'failed', reason: fetched.reason }

	try {
		if (tool === 'chdman') return await verifyChd(fetched.localPath, run)

		// An RVZ is judged by the catalogue, never by the tool's exit code: on a
		// corrupted file dolphin-tool still answers 0 and "Problems Found: No".
		const catalog = await loadDatForSystem(row.system)
		return await verifyRvz(fetched.localPath, catalog.status === 'ok' ? catalog.dat : null, run)
	} finally {
		await fetched.cleanup()
	}
}
