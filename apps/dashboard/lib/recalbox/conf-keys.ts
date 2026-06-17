/**
 * Low-level read/write of arbitrary recalbox.conf keys over SSH, reusing the
 * line-preserving editor. Shared by the typed "conf section" helpers and any
 * route that needs to touch a handful of flat keys.
 */

import { RECALBOX_CONF_PATH, parseConfValues, setConfValues } from './recalbox-conf-editor'
import { shellQuote } from './shell'
import { getSshClient } from './ssh-client'

async function readConf(recalboxId: string): Promise<string> {
	const ssh = getSshClient(recalboxId)
	return ssh.exec(`cat ${shellQuote(RECALBOX_CONF_PATH)} 2>/dev/null || true`, 10_000)
}

/** Read the given keys from recalbox.conf (null when absent or commented out). */
export async function readConfKeys(
	recalboxId: string,
	keys: string[],
): Promise<Record<string, string | null>> {
	return parseConfValues(await readConf(recalboxId), keys)
}

/**
 * Apply the given key changes to recalbox.conf over SSH (null removes a key).
 * Returns false when the file is missing/empty (so callers can 404), true on a
 * successful write. A `.bak-dashboard` backup is created before writing.
 */
export async function writeConfKeys(
	recalboxId: string,
	changes: Record<string, string | null>,
): Promise<boolean> {
	const conf = await readConf(recalboxId)
	if (!conf.trim()) return false
	const next = setConfValues(conf, changes)
	const ssh = getSshClient(recalboxId)
	await ssh.writeFile(RECALBOX_CONF_PATH, next, {
		backupPath: `${RECALBOX_CONF_PATH}.bak-dashboard`,
		timeoutMs: 15_000,
	})
	return true
}
