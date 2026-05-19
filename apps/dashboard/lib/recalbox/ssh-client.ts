import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { NodeSSH } from 'node-ssh'

const EXEC_TIMEOUT_MS = 5000
const CONNECT_TIMEOUT_MS = 8000

type QueueItem = { resolve: () => void; reject: (err: Error) => void }

class SshClient {
	private ssh = new NodeSSH()
	private connected = false
	private connectingPromise: Promise<void> | null = null
	private activeCount = 0
	private readonly waitQueue: QueueItem[] = []

	constructor(
		private readonly recalboxId: string,
		private readonly maxConcurrent = 2,
	) {}

	private async connect(): Promise<void> {
		if (this.connectingPromise) return this.connectingPromise
		this.connectingPromise = (async () => {
			this.ssh.dispose()
			this.ssh = new NodeSSH()
			const cfg = configStore.getForRecalbox(this.recalboxId).recalbox
			const connectPromise = this.ssh.connect({
				host: cfg.host,
				username: cfg.sshUser,
				password: cfg.sshPassword,
				port: cfg.sshPort,
				readyTimeout: EXEC_TIMEOUT_MS,
				keepaliveInterval: 10000,
			})
			const timeout = new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error(`SSH connect timed out after ${CONNECT_TIMEOUT_MS}ms`)),
					CONNECT_TIMEOUT_MS,
				),
			)
			await Promise.race([connectPromise, timeout])
			this.connected = true
			this.ssh.connection?.on('error', (err: unknown) => {
				this.connected = false
				logger.error(`SSH [${this.recalboxId}] connection reset externally`, err)
			})
			logger.info(`SSH [${this.recalboxId}] connected to ${cfg.host}`)
		})().finally(() => {
			this.connectingPromise = null
		})
		return this.connectingPromise
	}

	private acquire(): Promise<void> {
		if (this.activeCount < this.maxConcurrent) {
			this.activeCount++
			return Promise.resolve()
		}
		return new Promise<void>((resolve, reject) => this.waitQueue.push({ resolve, reject }))
	}

	private release(): void {
		const next = this.waitQueue.shift()
		if (next) {
			next.resolve()
		} else {
			this.activeCount--
		}
	}

	// Fail all waiting items immediately instead of letting each one retry a broken connection.
	// Prevents a cascade of N reconnect attempts when the connection is down.
	private failQueue(err: Error): void {
		const items = this.waitQueue.splice(0)
		for (const item of items) item.reject(err)
	}

	private async runExec(command: string, timeoutMs: number): Promise<string> {
		if (!this.connected || !this.ssh.isConnected()) await this.connect()
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

	async exec(command: string, timeoutMs = EXEC_TIMEOUT_MS): Promise<string> {
		await this.acquire()
		try {
			try {
				return await this.runExec(command, timeoutMs)
			} catch {
				try {
					await this.connect()
				} catch (connectErr) {
					const err = connectErr instanceof Error ? connectErr : new Error(String(connectErr))
					this.failQueue(err)
					throw err
				}
				return await this.runExec(command, timeoutMs)
			}
		} finally {
			this.release()
		}
	}

	disconnect(): void {
		this.ssh.dispose()
		this.connected = false
		this.failQueue(new Error('SSH client disconnected'))
	}
}

const POOL_VERSION = 3

class SshPool {
	private clients = new Map<string, SshClient>()
	// tracks all pool keys for a given recalboxId so removeClient can clean up all variants
	private idToKeys = new Map<string, Set<string>>()

	getClient(recalboxId: string, variant = 'default'): SshClient {
		const key = variant === 'default' ? recalboxId : `${recalboxId}:${variant}`
		let client = this.clients.get(key)
		if (!client) {
			// Media requests are high-volume; allow more parallelism on their dedicated connection
			const maxConcurrent = variant === 'media' ? 5 : 2
			client = new SshClient(recalboxId, maxConcurrent)
			this.clients.set(key, client)
			if (!this.idToKeys.has(recalboxId)) this.idToKeys.set(recalboxId, new Set())
			this.idToKeys.get(recalboxId)!.add(key)
		}
		return client
	}

	removeClient(recalboxId: string): void {
		for (const key of this.idToKeys.get(recalboxId) ?? []) {
			this.clients.get(key)?.disconnect()
			this.clients.delete(key)
		}
		this.idToKeys.delete(recalboxId)
	}

	async closeAll(): Promise<void> {
		for (const client of this.clients.values()) client.disconnect()
		this.clients.clear()
		this.idToKeys.clear()
	}
}

const g = globalThis as typeof globalThis & {
	__sshPool?: SshPool
	__sshPoolVersion?: number
}

if (!g.__sshPool || g.__sshPoolVersion !== POOL_VERSION) {
	g.__sshPool?.closeAll()
	g.__sshPool = new SshPool()
	g.__sshPoolVersion = POOL_VERSION
	configStore.on('recalbox:updated', ({ recalbox }) => {
		g.__sshPool?.removeClient(recalbox.id)
	})
	configStore.on('recalbox:removed', ({ id }) => {
		g.__sshPool?.removeClient(id)
	})
}

export const sshPool = g.__sshPool

export type SshClientLike = { exec: (cmd: string, timeoutMs?: number) => Promise<string> }

export function getSshClient(recalboxId: string, variant?: string): SshClient {
	return sshPool.getClient(recalboxId, variant)
}

export const sshClient = new Proxy({} as SshClient, {
	get(_target, prop) {
		const id = configStore.getDefaultRecalbox()?.id
		if (!id) throw new Error('No Recalbox configured')
		return (sshPool.getClient(id) as unknown as Record<string, unknown>)[prop as string]
	},
})
