import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { NodeSSH } from 'node-ssh'

const EXEC_TIMEOUT_MS = 5000
const CONNECT_TIMEOUT_MS = 8000
const MAX_CONCURRENT = 2

class SshClient {
	private ssh = new NodeSSH()
	private connected = false
	private connectingPromise: Promise<void> | null = null
	private activeCount = 0
	private readonly waitQueue: Array<() => void> = []

	private async connect(): Promise<void> {
		if (this.connectingPromise) return this.connectingPromise
		this.connectingPromise = (async () => {
			// Dispose and recreate to avoid stale state after ECONNRESET
			this.ssh.dispose()
			this.ssh = new NodeSSH()
			const { host, sshUser, sshPassword, sshPort } = configStore.get().recalbox
			const connectPromise = this.ssh.connect({
				host,
				username: sshUser,
				password: sshPassword,
				port: sshPort,
				readyTimeout: EXEC_TIMEOUT_MS,
				keepaliveInterval: 10000,
			})
			const connectTimeout = new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error(`SSH connect timed out after ${CONNECT_TIMEOUT_MS}ms`)),
					CONNECT_TIMEOUT_MS,
				),
			)
			await Promise.race([connectPromise, connectTimeout])
			this.connected = true
			// Prevent uncaughtException when the server resets the connection externally
			this.ssh.connection?.on('error', (err: unknown) => {
				this.connected = false
				logger.error('SSH connection reset externally', err)
			})
			logger.info(`SSH connected to ${host}`)
		})().finally(() => {
			this.connectingPromise = null
		})
		return this.connectingPromise
	}

	private acquire(): Promise<void> {
		if (this.activeCount < MAX_CONCURRENT) {
			this.activeCount++
			return Promise.resolve()
		}
		return new Promise<void>((resolve) => this.waitQueue.push(resolve))
	}

	private release(): void {
		const next = this.waitQueue.shift()
		if (next) {
			next()
		} else {
			this.activeCount--
		}
	}

	private async runExec(command: string, timeoutMs: number): Promise<string> {
		if (!this.connected || !this.ssh.isConnected()) {
			await this.connect()
		}

		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`SSH command timed out: ${command}`)), timeoutMs),
		)

		const execPromise = this.ssh.execCommand(command).then((result) => {
			if (result.stderr) logger.warn(`SSH stderr for "${command}": ${result.stderr}`)
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

	/** Execute a command over SSH and return trimmed stdout. Retries once after reconnect on transient errors. */
	async exec(command: string, timeoutMs = EXEC_TIMEOUT_MS): Promise<string> {
		await this.acquire()
		try {
			try {
				return await this.runExec(command, timeoutMs)
			} catch {
				await this.connect()
				return await this.runExec(command, timeoutMs)
			}
		} finally {
			this.release()
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
