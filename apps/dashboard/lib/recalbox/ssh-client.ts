import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { NodeSSH } from 'node-ssh'

const EXEC_TIMEOUT_MS = 5000

class SshClient {
	private ssh = new NodeSSH()
	private connected = false

	private async connect(): Promise<void> {
		const { host, sshUser, sshPassword, sshPort } = configStore.get().recalbox
		await this.ssh.connect({
			host,
			username: sshUser,
			password: sshPassword,
			port: sshPort,
			readyTimeout: EXEC_TIMEOUT_MS,
		})
		this.connected = true
		logger.info(`SSH connected to ${host}`)
	}

	/** Execute a command over SSH and return trimmed stdout. */
	async exec(command: string, timeoutMs = EXEC_TIMEOUT_MS): Promise<string> {
		if (!this.connected || !this.ssh.isConnected()) {
			await this.connect()
		}

		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`SSH command timed out: ${command}`)), timeoutMs),
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

	/** Disconnect and mark as not connected — next exec() will reconnect with current config. */
	disconnect(): void {
		this.ssh.dispose()
		this.connected = false
	}
}

export const sshClient = new SshClient()

configStore.on('changed:recalbox', () => {
	logger.info('SSH: config changed, disconnecting (will reconnect on next request)')
	sshClient.disconnect()
})
