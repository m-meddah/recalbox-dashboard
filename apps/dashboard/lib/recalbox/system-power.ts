import { logger } from '@/lib/logger'
import type { SshClientLike } from '@/lib/recalbox/ssh-client'

const POWER_TIMEOUT_MS = 2000

const CONNECTION_RESET_PATTERNS = ['ECONNRESET', 'ECONNREFUSED', 'timed out', 'socket hang up']

function isExpectedDisconnect(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return CONNECTION_RESET_PATTERNS.some((p) => msg.includes(p))
}

export async function executeSystemPower(
	action: 'shutdown' | 'reboot',
	ssh: SshClientLike,
): Promise<void> {
	const command = action === 'shutdown' ? 'poweroff' : 'reboot'
	try {
		await ssh.exec(command, POWER_TIMEOUT_MS)
	} catch (err) {
		if (isExpectedDisconnect(err)) {
			logger.info(`SSH disconnected after ${command} — expected`)
			return
		}
		throw err
	}
}
