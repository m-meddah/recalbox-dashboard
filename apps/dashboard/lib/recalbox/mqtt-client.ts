import { EventEmitter } from 'node:events'
import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import mqtt from 'mqtt'
import { parseRecalboxMessage } from './events'
import type { GameStartEvent, GameStopEvent, SystemChangeEvent, SystemInfoEvent } from './events'

const ES_EVENT_TOPIC = 'Recalbox/WebAPI/EmulationStation/Event'
const SYSTEM_INFO_TOPIC = 'Recalbox/WebAPI/SystemInfo'

// Bump this whenever subscriptions or public API change — forces globalThis recreation
const SINGLETON_VERSION = 6

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

class RecalboxMqttClient extends EventEmitter {
	private client: mqtt.MqttClient | null = null
	private reconnectAttempt = 0
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private currentSystem: string | null = null

	isConnected = false
	lastKnownGame: GameStartEvent | null = null

	connect(): void {
		if (this.client) return
		this.createConnection()
	}

	private createConnection(): void {
		const { host, mqttPort } = configStore.get().recalbox
		const brokerUrl = `mqtt://${host}:${mqttPort}`
		logger.info(`MQTT connecting to ${brokerUrl}`)

		this.client = mqtt.connect(brokerUrl, {
			reconnectPeriod: 0,
			connectTimeout: 5000,
			clientId: `recalbox-dashboard-${Math.random().toString(16).slice(2, 10)}`,
		})

		this.client.on('connect', () => {
			this.reconnectAttempt = 0
			this.isConnected = true
			logger.info('MQTT connected')
			this.client!.subscribe(ES_EVENT_TOPIC, { qos: 0 })
			this.client!.subscribe(SYSTEM_INFO_TOPIC, { qos: 0 })
			this.emit('connection:up')
		})

		this.client.on('message', (topic, payload) => {
			const event = parseRecalboxMessage(topic, payload)
			if (!event) return

			if (event.type === 'game:start') {
				logger.info(`game:start — ${event.gameName} [${event.system}]`)
				this.currentSystem = event.system
				this.lastKnownGame = event
				this.emit('game:start', event)
			} else if (event.type === 'game:stop') {
				logger.info(`game:stop — ${event.gameName} [${event.system}]`)
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

		this.client.on('error', (err) => {
			logger.error('MQTT error', err)
		})

		this.client.on('close', () => {
			this.isConnected = false
			logger.warn('MQTT disconnected')
			this.emit('connection:down')
			this.scheduleReconnect()
		})
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return
		const delay = BACKOFF_DELAYS_MS[Math.min(this.reconnectAttempt, BACKOFF_DELAYS_MS.length - 1)]
		this.reconnectAttempt++
		logger.info(`MQTT reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)
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
		logger.info('MQTT: reconnecting with new config')
		this.disconnect()
		this.reconnectAttempt = 0
		this.createConnection()
	}
}

const g = globalThis as typeof globalThis & {
	__recalboxMqtt?: RecalboxMqttClient
	__recalboxMqttVersion?: number
}

export function getMqttClient(): RecalboxMqttClient {
	if (!g.__recalboxMqtt || g.__recalboxMqttVersion !== SINGLETON_VERSION) {
		g.__recalboxMqtt?.disconnect()
		g.__recalboxMqtt = new RecalboxMqttClient()
		g.__recalboxMqtt.connect()
		g.__recalboxMqttVersion = SINGLETON_VERSION

		configStore.on('changed:recalbox', () => {
			g.__recalboxMqtt?.reconnect()
		})
	}
	return g.__recalboxMqtt
}
