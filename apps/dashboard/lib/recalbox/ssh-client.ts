import { NodeSSH } from 'node-ssh'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

const EXEC_TIMEOUT_MS = 5000

class SshClient {
	private ssh = new NodeSSH()
	private connected = false

	private async connect(): Promise<void> {
		await this.ssh.connect({
			host: config.recalbox.host,
			username: config.recalbox.sshUser,
			password: config.recalbox.sshPassword,
			readyTimeout: EXEC_TIMEOUT_MS,
		})
		this.connected = true
		logger.info(`SSH connected to ${config.recalbox.host}`)
	}

	/** Execute a command over SSH and return trimmed stdout. */
	async exec(command: string): Promise<string> {
		if (!this.connected || !this.ssh.isConnected()) {
			await this.connect()
		}

		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`SSH command timed out: ${command}`)), EXEC_TIMEOUT_MS),
		)

		const execPromise = this.ssh.execCommand(command).then((result) => {
			if (result.stderr) {
				logger.warn(`SSH stderr for "${command}": ${result.stderr}`)
			}
			return result.stdout.trim()
		})

		try {
			return await Promise.race([execPromise, timeoutPromise])
		} catch (err) {
			this.connected = false
			logger.error(`SSH exec failed for "${command}", marking disconnected`, err)
			throw err
		}
	}

	/** Gracefully close the SSH connection. */
	dispose(): void {
		this.ssh.dispose()
		this.connected = false
	}
}

// Singleton — one connection shared across all server-side calls
export const sshClient = new SshClient()
