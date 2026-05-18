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

	constructor(private readonly recalboxId: string) {}

	private async connect(): Promise<void> {
		if (this.connectingPromise) return this.connectingPromise
		this.connectingPromise = (async () => {
			this.ssh.dispose()
			this.ssh = new NodeSSH()
			const cfg = configStore.getForRecalbox(this.recalboxId).recalbox
			const connectPromise = this.ssh.connect({
				host: cfg.host, username: cfg.sshUser, password: cfg.sshPassword,
				port: cfg.sshPort, readyTimeout: EXEC_TIMEOUT_MS, keepaliveInterval: 10000,
			})
			const timeout = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error(`SSH connect timed out after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS),
			)
			await Promise.race([connectPromise, timeout])
			this.connected = true
			this.ssh.connection?.on('error', (err: unknown) => {
				this.connected = false
				logger.error(`SSH [${this.recalboxId}] connection reset externally`, err)
			})
			logger.info(`SSH [${this.recalboxId}] connected to ${cfg.host}`)
		})().finally(() => { this.connectingPromise = null })
		return this.connectingPromise
	}

	private acquire(): Promise<void> {
		if (this.activeCount < MAX_CONCURRENT) { this.activeCount++; return Promise.resolve() }
		return new Promise<void>((resolve) => this.waitQueue.push(resolve))
	}

	private release(): void {
		const next = this.waitQueue.shift()
		if (next) { next() } else { this.activeCount-- }
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
			try { return await this.runExec(command, timeoutMs) } catch {
				await this.connect()
				return await this.runExec(command, timeoutMs)
			}
		} finally { this.release() }
	}

	disconnect(): void {
		this.ssh.dispose()
		this.connected = false
	}
}

const POOL_VERSION = 1

class SshPool {
	private clients = new Map<string, SshClient>()

	getClient(recalboxId: string): SshClient {
		if (!this.clients.has(recalboxId)) {
			this.clients.set(recalboxId, new SshClient(recalboxId))
		}
		return this.clients.get(recalboxId)!
	}

	removeClient(recalboxId: string): void {
		this.clients.get(recalboxId)?.disconnect()
		this.clients.delete(recalboxId)
	}

	async closeAll(): Promise<void> {
		for (const client of this.clients.values()) client.disconnect()
		this.clients.clear()
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

export function getSshClient(recalboxId: string): SshClient {
	return sshPool.getClient(recalboxId)
}

export const sshClient = new Proxy({} as SshClient, {
	get(_target, prop) {
		const id = configStore.getDefaultRecalbox()?.id
		if (!id) throw new Error('No Recalbox configured')
		return (sshPool.getClient(id) as unknown as Record<string, unknown>)[prop as string]
	},
})
