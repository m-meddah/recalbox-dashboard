import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { NodeSSH } from 'node-ssh'
import { shellQuote } from './shell'

const EXEC_TIMEOUT_MS = 5000
const CONNECT_TIMEOUT_MS = 3000
// After a failed connect, reject all attempts for this duration before retrying.
const CONNECT_BACKOFF_MS = 15_000

type QueueItem = { resolve: () => void; reject: (err: Error) => void }

class SshClient {
	private ssh = new NodeSSH()
	private connected = false
	private connectingPromise: Promise<void> | null = null
	private backoffUntil = 0
	private activeCount = 0
	private readonly waitQueue: QueueItem[] = []

	constructor(
		private readonly recalboxId: string,
		private readonly maxConcurrent = 2,
	) {}

	private async connect(): Promise<void> {
		// Join an in-progress attempt rather than starting a second one.
		if (this.connectingPromise) return this.connectingPromise
		// Fail fast while the host is known to be unreachable.
		if (Date.now() < this.backoffUntil) {
			throw new Error(
				`SSH [${this.recalboxId}] in backoff until ${new Date(this.backoffUntil).toISOString()}`,
			)
		}
		this.connectingPromise = (async () => {
			this.ssh.dispose()
			this.ssh = new NodeSSH()
			const cfg = configStore.getForRecalbox(this.recalboxId).recalbox
			const connectPromise = this.ssh.connect({
				host: cfg.host,
				username: cfg.sshUser,
				password: cfg.sshPassword,
				port: cfg.sshPort,
				readyTimeout: CONNECT_TIMEOUT_MS + 2000,
				keepaliveInterval: 10000,
			})
			const timeout = new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error(`SSH connect timed out after ${CONNECT_TIMEOUT_MS}ms`)),
					CONNECT_TIMEOUT_MS,
				),
			)
			try {
				await Promise.race([connectPromise, timeout])
			} catch (err) {
				this.backoffUntil = Date.now() + CONNECT_BACKOFF_MS
				throw err
			}
			this.backoffUntil = 0
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

	private async runExec(command: string, timeoutMs: number, stdin?: string): Promise<string> {
		if (!this.connected || !this.ssh.isConnected()) await this.connect()
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`SSH command timed out: ${command}`)), timeoutMs),
		)
		const execPromise = this.ssh.execCommand(command, { stdin }).then((result) => {
			if (result.stderr) logger.warn(`SSH stderr for "${command}": ${result.stderr}`)
			return result.stdout.trim()
		})
		return await Promise.race([execPromise, timeoutPromise])
	}

	async exec(command: string, timeoutMs = EXEC_TIMEOUT_MS, stdin?: string): Promise<string> {
		await this.acquire()
		try {
			try {
				return await this.runExec(command, timeoutMs, stdin)
			} catch (err) {
				// A command-level failure (e.g. a slow read hitting the per-command
				// timeout) is NOT a dead connection. Tearing down the shared client
				// here would dispose() the connection mid-flight and abort every
				// sibling command riding on it — the cascade that floods the logs
				// with bursts of timeouts followed by a reconnect. If the transport
				// is still up, fail just this one request and leave the rest alone.
				if (this.ssh.isConnected()) {
					logger.warn(`SSH command failed (connection still up): ${command}`)
					throw err
				}
				this.connected = false
				logger.error('SSH connection lost, reconnecting', err)
				try {
					await this.connect()
				} catch (connectErr) {
					const e = connectErr instanceof Error ? connectErr : new Error(String(connectErr))
					this.failQueue(e)
					throw e
				}
				return await this.runExec(command, timeoutMs, stdin)
			}
		} finally {
			this.release()
		}
	}

	/**
	 * Write `content` to a remote file by streaming it over the command's stdin —
	 * safe for large files (multi-MB gamelists) that would blow past ARG_MAX if
	 * passed as a shell argument. When `backupPath` is given, the existing file is
	 * copied there first (best-effort; missing source is ignored).
	 */
	async writeFile(
		path: string,
		content: string,
		opts: { backupPath?: string; timeoutMs?: number } = {},
	): Promise<void> {
		const timeoutMs = opts.timeoutMs ?? 30_000
		const quoted = shellQuote(path)
		const backup = opts.backupPath
			? `cp ${quoted} ${shellQuote(opts.backupPath)} 2>/dev/null; `
			: ''
		await this.exec(`${backup}cat > ${quoted}`, timeoutMs, content)
	}

	/**
	 * Download a remote file to the host over SFTP.
	 *
	 * Reserved for large, occasional transfers (a CHD or RVZ pulled for deep
	 * verification), which is why callers should ask the pool for a dedicated
	 * variant: a multi-gigabyte copy would otherwise hold one of the two shared
	 * execution slots for minutes.
	 */
	async getFile(localPath: string, remotePath: string): Promise<void> {
		await this.acquire()
		try {
			if (!this.connected || !this.ssh.isConnected()) await this.connect()
			await this.ssh.getFile(localPath, remotePath)
		} finally {
			this.release()
		}
	}

	disconnect(): void {
		this.ssh.dispose()
		this.connected = false
		this.backoffUntil = 0
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
			this.idToKeys.get(recalboxId)?.add(key)
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

const sshPool = g.__sshPool

export type SshClientLike = { exec: (cmd: string, timeoutMs?: number) => Promise<string> }

export function getSshClient(recalboxId: string, variant?: string): SshClient {
	return sshPool.getClient(recalboxId, variant)
}

const sshClient = new Proxy({} as SshClient, {
	get(_target, prop) {
		const id = configStore.getDefaultRecalbox()?.id
		if (!id) throw new Error('No Recalbox configured')
		return (sshPool.getClient(id) as unknown as Record<string, unknown>)[prop as string]
	},
})
