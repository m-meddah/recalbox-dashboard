import { EventEmitter } from 'node:events'
import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import mqtt from 'mqtt'
import { parseRecalboxMessage } from './events'
import type { GameStartEvent, GameStopEvent, SystemChangeEvent, SystemInfoEvent } from './events'

const ES_EVENT_TOPIC = 'Recalbox/WebAPI/EmulationStation/Event'
const SYSTEM_INFO_TOPIC = 'Recalbox/WebAPI/SystemInfo'
const SINGLETON_VERSION = 7
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000]

interface RecalboxClientEvents {
	'game:start': (event: GameStartEvent) => void
	'game:stop': (event: GameStopEvent) => void
	'system:change': (event: SystemChangeEvent) => void
	'system:info': (event: SystemInfoEvent) => void
	'connection:up': () => void
	'connection:down': () => void
}

declare interface RecalboxMqttClient {
	on<K extends keyof RecalboxClientEvents>(event: K, listener: RecalboxClientEvents[K]): this
	off<K extends keyof RecalboxClientEvents>(event: K, listener: RecalboxClientEvents[K]): this
	emit<K extends keyof RecalboxClientEvents>(
		event: K,
		...args: Parameters<RecalboxClientEvents[K]>
	): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter pattern
class RecalboxMqttClient extends EventEmitter {
	private client: mqtt.MqttClient | null = null
	private reconnectAttempt = 0
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private currentSystem: string | null = null
	isConnected = false
	lastKnownGame: GameStartEvent | null = null

	constructor(private readonly brokerUrl: string) {
		super()
	}

	connect(): void {
		if (this.client) return
		this.createConnection()
	}

	private createConnection(): void {
		logger.info(`MQTT connecting to ${this.brokerUrl}`)
		this.client = mqtt.connect(this.brokerUrl, {
			reconnectPeriod: 0,
			connectTimeout: 5000,
			clientId: `recalbox-dashboard-${Math.random().toString(16).slice(2, 10)}`,
		})
		this.client.on('connect', () => {
			this.reconnectAttempt = 0
			this.isConnected = true
			logger.info(`MQTT connected to ${this.brokerUrl}`)
			this.client?.subscribe(ES_EVENT_TOPIC, { qos: 0 })
			this.client?.subscribe(SYSTEM_INFO_TOPIC, { qos: 0 })
			this.emit('connection:up')
		})
		this.client.on('message', (topic, payload) => {
			const event = parseRecalboxMessage(topic, payload)
			if (!event) return
			if (event.type === 'game:start') {
				this.currentSystem = event.system
				this.lastKnownGame = event
				this.emit('game:start', event)
			} else if (event.type === 'game:stop') {
				if (this.lastKnownGame?.romPath === event.romPath) this.lastKnownGame = null
				this.emit('game:stop', event)
			} else if (event.type === 'system:change') {
				if (event.system !== this.currentSystem) {
					this.currentSystem = event.system
					this.emit('system:change', event)
				}
			} else if (event.type === 'system:info') {
				this.emit('system:info', event)
			}
		})
		this.client.on('error', (err) => logger.error('MQTT error', err))
		this.client.on('close', () => {
			this.isConnected = false
			logger.warn(`MQTT disconnected from ${this.brokerUrl}`)
			this.emit('connection:down')
			this.scheduleReconnect()
		})
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return
		const delay = BACKOFF_DELAYS_MS[Math.min(this.reconnectAttempt, BACKOFF_DELAYS_MS.length - 1)]
		this.reconnectAttempt++
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			this.client = null
			this.createConnection()
		}, delay)
	}

	disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
		this.client?.end()
		this.client = null
		this.isConnected = false
	}

	reconnect(): void {
		this.disconnect()
		this.reconnectAttempt = 0
		this.createConnection()
	}
}

class MqttPool {
	private clients = new Map<string, RecalboxMqttClient>()

	getClient(recalboxId: string): RecalboxMqttClient {
		let client = this.clients.get(recalboxId)
		if (!client) {
			const rb = configStore.getRecalbox(recalboxId)
			if (!rb) throw new Error(`Recalbox ${recalboxId} not found`)
			const url = `mqtt://${rb.host}:${rb.mqttPort}`
			client = new RecalboxMqttClient(url)
			client.connect()
			this.clients.set(recalboxId, client)
		}
		return client
	}

	removeClient(recalboxId: string): void {
		this.clients.get(recalboxId)?.disconnect()
		this.clients.delete(recalboxId)
	}

	getAllClients(): Map<string, RecalboxMqttClient> {
		return this.clients
	}

	disconnectAll(): void {
		for (const client of this.clients.values()) client.disconnect()
		this.clients.clear()
	}
}

const g = globalThis as typeof globalThis & {
	__mqttPool?: MqttPool
	__mqttPoolVersion?: number
}

if (!g.__mqttPool || g.__mqttPoolVersion !== SINGLETON_VERSION) {
	g.__mqttPool?.disconnectAll()
	g.__mqttPool = new MqttPool()
	g.__mqttPoolVersion = SINGLETON_VERSION

	configStore.on('recalbox:added', ({ recalbox }) => {
		if (!recalbox.archived) g.__mqttPool?.getClient(recalbox.id)
	})
	configStore.on('recalbox:updated', ({ recalbox }) => {
		g.__mqttPool?.removeClient(recalbox.id)
		if (!recalbox.archived) g.__mqttPool?.getClient(recalbox.id)
	})
	configStore.on('recalbox:removed', ({ id }) => {
		g.__mqttPool?.removeClient(id)
	})

	try {
		for (const rb of configStore.getRecalboxes().filter((r) => !r.archived)) {
			try {
				g.__mqttPool.getClient(rb.id)
			} catch {
				/* ignore per-client failures */
			}
		}
	} catch {
		/* recalboxes table may not exist yet — migration runs at runtime */
	}
}

export const mqttPool = g.__mqttPool

export function getMqttClientFor(recalboxId: string): RecalboxMqttClient {
	return mqttPool.getClient(recalboxId)
}

export function getMqttClient(): RecalboxMqttClient {
	const id = configStore.getDefaultRecalbox()?.id
	if (!id) {
		const noop = new RecalboxMqttClient('mqtt://localhost:1883')
		return noop
	}
	return mqttPool.getClient(id)
}

export type { RecalboxMqttClient }
