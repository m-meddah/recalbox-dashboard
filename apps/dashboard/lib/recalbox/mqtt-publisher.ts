import { configStore } from '@/lib/config-store'
import { getLastClosedSession, getSessionStats } from '@/lib/db/queries'
import { logger } from '@/lib/logger'
import { calculateStreaks } from '@/lib/stats/calculators'
import mqtt from 'mqtt'

const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000]

export type AnalyticsSnapshot = {
	playtimeTodaySec: number
	playtimeWeekSec: number
	currentStreak: number
	longestStreak: number
	sessionsToday: number
	topGameWeek: string
	lastGame: { name: string; system: string; durationSec: number } | null
}

export async function computeAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
	const now = new Date()
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

	const [todayStats, weekStats, allStats, lastGame] = await Promise.all([
		getSessionStats({ fromDate: startOfToday }),
		getSessionStats({ fromDate: weekAgo }),
		getSessionStats({}),
		getLastClosedSession(),
	])

	const { currentStreak, longestStreak } = calculateStreaks(allStats.byDay)
	const topGameWeek = weekStats.topGames[0]?.gameName ?? ''

	return {
		playtimeTodaySec: todayStats.totalPlaytimeSec,
		playtimeWeekSec: weekStats.totalPlaytimeSec,
		currentStreak,
		longestStreak,
		sessionsToday: todayStats.totalSessions,
		topGameWeek,
		lastGame: lastGame
			? { name: lastGame.gameName, system: lastGame.system, durationSec: lastGame.durationSec }
			: null,
	}
}

class MqttPublisher {
	private client: mqtt.MqttClient | null = null
	private topicPrefix = 'RecalboxDashboard/'
	private resolvedUrl = ''
	private reconnectAttempt = 0
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	isConnected = false

	connect(brokerUrl: string, topicPrefix: string): void {
		this.disconnect()
		this.topicPrefix = topicPrefix
		this.resolvedUrl = brokerUrl || `mqtt://${configStore.getDefaultRecalbox()?.host ?? 'localhost'}:1883`
		this.reconnectAttempt = 0
		this.createConnection()
	}

	private createConnection(): void {
		logger.info(`MQTT publisher connecting to ${this.resolvedUrl}`)
		this.client = mqtt.connect(this.resolvedUrl, {
			clientId: `recalbox-dashboard-pub-${Math.random().toString(16).slice(2, 10)}`,
			reconnectPeriod: 0,
			connectTimeout: 5000,
			will: {
				topic: `${this.topicPrefix}status`,
				payload: Buffer.from('offline'),
				retain: true,
				qos: 1,
			},
		})

		this.client.on('connect', () => {
			this.reconnectAttempt = 0
			this.isConnected = true
			logger.info(`MQTT publisher connected to ${this.resolvedUrl}`)
			this.publishStatus('online')
			if (configStore.get().mqttPublish.homeAssistantDiscovery) {
				this.publishHaDiscovery()
			}
			computeAnalyticsSnapshot()
				.then((snapshot) => this.publishAnalytics(snapshot))
				.catch((err) => logger.error('MQTT publisher: failed to compute initial snapshot', err))
		})

		this.client.on('error', (err) => logger.error('MQTT publisher error', err))
		this.client.on('close', () => {
			this.isConnected = false
			logger.warn(`MQTT publisher disconnected from ${this.resolvedUrl}`)
			this.scheduleReconnect()
		})
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) return
		const delay = BACKOFF_DELAYS_MS[Math.min(this.reconnectAttempt, BACKOFF_DELAYS_MS.length - 1)]
		this.reconnectAttempt++
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			if (!this.resolvedUrl) return
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
		this.resolvedUrl = ''
	}

	publishAnalytics(snapshot: AnalyticsSnapshot): void {
		if (!this.client || !this.isConnected) return
		const p = this.topicPrefix
		const pub = (topic: string, payload: string) => {
			this.client?.publish(`${p}${topic}`, payload, { retain: true, qos: 1 })
		}
		pub('playtime/today', String(snapshot.playtimeTodaySec))
		pub('playtime/week', String(snapshot.playtimeWeekSec))
		pub('streak/current', String(snapshot.currentStreak))
		pub('streak/longest', String(snapshot.longestStreak))
		pub('sessions/today', String(snapshot.sessionsToday))
		pub('topgame/week', snapshot.topGameWeek)
		pub('lastgame', snapshot.lastGame ? JSON.stringify(snapshot.lastGame) : '')
	}

	publishStatus(status: 'online' | 'offline'): void {
		this.client?.publish(`${this.topicPrefix}status`, status, { retain: true, qos: 1 })
	}

	publishHaDiscovery(): void {
		if (!this.client || !this.isConnected) return
		const prefix = this.topicPrefix
		const device = {
			identifiers: ['recalbox_dashboard'],
			name: 'Recalbox Dashboard',
			model: 'Recalbox Dashboard',
			manufacturer: 'recalbox-dashboard',
		}
		const availability = {
			availability_topic: `${prefix}status`,
			payload_available: 'online',
			payload_not_available: 'offline',
		}
		const sensors: Array<{
			id: string
			name: string
			state_topic: string
			unit_of_measurement?: string
			device_class?: string
		}> = [
			{
				id: 'playtime_today',
				name: 'Recalbox Playtime Today',
				state_topic: `${prefix}playtime/today`,
				unit_of_measurement: 's',
				device_class: 'duration',
			},
			{
				id: 'playtime_week',
				name: 'Recalbox Playtime Week',
				state_topic: `${prefix}playtime/week`,
				unit_of_measurement: 's',
				device_class: 'duration',
			},
			{
				id: 'streak_current',
				name: 'Recalbox Current Streak',
				state_topic: `${prefix}streak/current`,
				unit_of_measurement: 'd',
			},
			{
				id: 'streak_longest',
				name: 'Recalbox Longest Streak',
				state_topic: `${prefix}streak/longest`,
				unit_of_measurement: 'd',
			},
			{
				id: 'sessions_today',
				name: 'Recalbox Sessions Today',
				state_topic: `${prefix}sessions/today`,
			},
			{
				id: 'topgame_week',
				name: 'Recalbox Top Game This Week',
				state_topic: `${prefix}topgame/week`,
			},
			{
				id: 'lastgame',
				name: 'Recalbox Last Game',
				state_topic: `${prefix}lastgame`,
			},
			{
				id: 'status',
				name: 'Recalbox Dashboard Status',
				state_topic: `${prefix}status`,
				device_class: 'connectivity',
			},
		]
		for (const sensor of sensors) {
			const config = {
				name: sensor.name,
				unique_id: `recalbox_dashboard_${sensor.id}`,
				state_topic: sensor.state_topic,
				...(sensor.unit_of_measurement && { unit_of_measurement: sensor.unit_of_measurement }),
				...(sensor.device_class && { device_class: sensor.device_class }),
				...availability,
				device,
			}
			this.client?.publish(
				`homeassistant/sensor/recalbox_dashboard_${sensor.id}/config`,
				JSON.stringify(config),
				{ retain: true, qos: 1 },
			)
		}
	}

	publishHaDiscoveryCleanup(): void {
		if (!this.client || !this.isConnected) return
		const sensorIds = [
			'playtime_today',
			'playtime_week',
			'streak_current',
			'streak_longest',
			'sessions_today',
			'topgame_week',
			'lastgame',
			'status',
		]
		for (const id of sensorIds) {
			this.client?.publish(
				`homeassistant/sensor/recalbox_dashboard_${id}/config`,
				'',
				{ retain: true, qos: 1 },
			)
		}
	}
}

const g = globalThis as typeof globalThis & { __mqttPublisher?: MqttPublisher }
if (!g.__mqttPublisher) g.__mqttPublisher = new MqttPublisher()
export const mqttPublisher = g.__mqttPublisher
