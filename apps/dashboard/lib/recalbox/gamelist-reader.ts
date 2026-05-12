import { sshClient } from './ssh-client'
import { shellQuote } from './shell'
import { logger } from '@/lib/logger'

const READ_TIMEOUT_MS = 30_000

/**
 * Read a gamelist.xml via SSH. Returns the raw XML string, or null if the
 * file does not exist (avoids throwing for missing systems).
 */
export async function readGamelist(gamelistPath: string): Promise<string | null> {
	return readRemoteFile(gamelistPath)
}

/**
 * Read a gamelist-userdata.ini via SSH. Returns raw content, or null.
 */
export async function readUserdataIni(romsBasePath: string): Promise<string | null> {
	return readRemoteFile(`${romsBasePath}/gamelist-userdata.ini`)
}

async function readRemoteFile(path: string): Promise<string | null> {
	try {
		const exists = await sshClient.exec(
			`test -f ${shellQuote(path)} && echo yes || echo no`,
		)
		if (exists !== 'yes') return null

		const content = await sshClient.exec(`cat ${shellQuote(path)}`, READ_TIMEOUT_MS)
		return content || null
	} catch (err) {
		logger.error(`readRemoteFile: failed to read ${path}`, err)
		return null
	}
}
