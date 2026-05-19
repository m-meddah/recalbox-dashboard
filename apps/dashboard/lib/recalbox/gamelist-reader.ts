import { logger } from '@/lib/logger'
import { shellQuote } from './shell'
import type { SshClientLike } from './ssh-client'

const READ_TIMEOUT_MS = 30_000

/**
 * Read a gamelist.xml via SSH. Returns the raw XML string, or null if the
 * file does not exist (avoids throwing for missing systems).
 */
export async function readGamelist(
	gamelistPath: string,
	ssh: SshClientLike,
): Promise<string | null> {
	return readRemoteFile(gamelistPath, ssh)
}

/**
 * Read a gamelist-userdata.ini via SSH. Returns raw content, or null.
 */
export async function readUserdataIni(
	romsBasePath: string,
	ssh: SshClientLike,
): Promise<string | null> {
	return readRemoteFile(`${romsBasePath}/gamelist-userdata.ini`, ssh)
}

async function readRemoteFile(path: string, ssh: SshClientLike): Promise<string | null> {
	try {
		const exists = await ssh.exec(`test -f ${shellQuote(path)} && echo yes || echo no`)
		if (exists !== 'yes') return null

		const content = await ssh.exec(`cat ${shellQuote(path)}`, READ_TIMEOUT_MS)
		return content || null
	} catch (err) {
		logger.error(`readRemoteFile: failed to read ${path}`, err)
		return null
	}
}
