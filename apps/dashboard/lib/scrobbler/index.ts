import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db/index'
import { logger } from '@/lib/logger'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'
import { getMqttClientFor, mqttPool } from '@/lib/recalbox/mqtt-client'
import { computeAnalyticsSnapshot, mqttPublisher } from '@/lib/recalbox/mqtt-publisher'
import { formatMqttUrl } from '@/lib/recalbox/mqtt-url'
import { SessionManager } from './session-manager'

export type Scrobbler = { stop: () => Promise<void> }

async function publishAnalyticsIfEnabled(): Promise<void> {
	try {
		if (!configStore.get().mqttPublish.enabled) return
		const snapshot = await computeAnalyticsSnapshot()
		mqttPublisher.publishAnalytics(snapshot)
	} catch (err) {
		logger.warn('MQTT analytics publish failed', err)
	}
}

export async function startScrobbler(): Promise<Scrobbler> {
	const manager = new SessionManager(db)
	const recovered = await manager.recoverOrphanSessions()
	if (recovered > 0) logger.info(`Recovered ${recovered} orphan session(s)`)

	// Connect MQTT publisher if enabled
	const initialCfg = configStore.get().mqttPublish
	if (initialCfg.enabled) {
		const url =
			initialCfg.brokerUrl ||
			formatMqttUrl(configStore.getDefaultRecalbox()?.host ?? 'localhost', 1883)
		mqttPublisher.connect(url, initialCfg.topicPrefix)
	}

	const subscriptions = new Map<
		string,
		{
			start: (e: GameStartEvent) => void
			stop: (e: GameStopEvent) => void
			screensaverStop: () => void
		}
	>()

	function subscribeToRecalbox(recalboxId: string): void {
		if (subscriptions.has(recalboxId)) return
		const client = getMqttClientFor(recalboxId)
		client.connect()

		const onStart = async (event: GameStartEvent) => {
			if (event.fromScreensaver) {
				logger.info(`Ignoring demo mode launch for ${event.romPath}`)
				return
			}
			try {
				await manager.openSession(event, recalboxId)
			} catch (err) {
				logger.error(`Error opening session [${recalboxId}]`, err)
			}
		}
		const onStop = async (event: GameStopEvent) => {
			try {
				await manager.closeSession(event)
				publishAnalyticsIfEnabled()
			} catch (err) {
				logger.error(`Error closing session [${recalboxId}]`, err)
			}
		}

		const onScreensaverStop = async () => {
			// User pressed a button to take over a demo-mode game — open a real session from now.
			// We check fromScreensaver on lastKnownGame: if the running game was launched by the
			// screensaver and the user just woke it up, it's now a real play session.
			if (!client.lastKnownGame?.fromScreensaver) return
			const realEvent: GameStartEvent = {
				...client.lastKnownGame,
				fromScreensaver: false,
				startedAt: new Date(),
			}
			try {
				await manager.openSession(realEvent, recalboxId)
				logger.info(`Opened takeover session for ${realEvent.romPath} (demo → real play)`)
			} catch (err) {
				logger.error(`Error opening takeover session [${recalboxId}]`, err)
			}
		}

		client.on('game:start', onStart)
		client.on('game:stop', onStop)
		client.on('screensaver:stop', onScreensaverStop)
		subscriptions.set(recalboxId, {
			start: onStart,
			stop: onStop,
			screensaverStop: onScreensaverStop,
		})
		logger.info(`Scrobbler subscribed to Recalbox ${recalboxId}`)
	}

	function unsubscribeFromRecalbox(recalboxId: string): void {
		const handlers = subscriptions.get(recalboxId)
		if (!handlers) return
		try {
			const client = getMqttClientFor(recalboxId)
			client.off('game:start', handlers.start)
			client.off('game:stop', handlers.stop)
			client.off('screensaver:stop', handlers.screensaverStop)
		} catch {}
		subscriptions.delete(recalboxId)
		logger.info(`Scrobbler unsubscribed from Recalbox ${recalboxId}`)
	}

	for (const rb of configStore.getRecalboxes().filter((r) => !r.archived)) {
		subscribeToRecalbox(rb.id)
	}

	const onAdded = ({ recalbox }: { recalbox: { id: string; archived: boolean } }) => {
		if (!recalbox.archived) subscribeToRecalbox(recalbox.id)
	}
	const onRemoved = ({ id }: { id: string }) => unsubscribeFromRecalbox(id)
	const onMqttPublishChanged = () => {
		const cfg = configStore.get().mqttPublish
		if (!cfg.enabled) {
			mqttPublisher.disconnect()
			return
		}
		const url =
			cfg.brokerUrl || formatMqttUrl(configStore.getDefaultRecalbox()?.host ?? 'localhost', 1883)
		mqttPublisher.connect(url, cfg.topicPrefix)
	}

	configStore.on('recalbox:added', onAdded)
	configStore.on('recalbox:removed', onRemoved)
	configStore.on('changed:mqttPublish', onMqttPublishChanged)

	// Periodic refresh: republish playtime/today every 5 minutes
	const refreshTimer = setInterval(publishAnalyticsIfEnabled, 5 * 60 * 1000)

	logger.info('Scrobbler listening for game events on all Recalboxes')

	return {
		stop: async () => {
			clearInterval(refreshTimer)
			configStore.off('recalbox:added', onAdded)
			configStore.off('recalbox:removed', onRemoved)
			configStore.off('changed:mqttPublish', onMqttPublishChanged)
			for (const id of subscriptions.keys()) unsubscribeFromRecalbox(id)
			await manager.closeAllOpenSessions('daemon_shutdown')
			mqttPublisher.disconnect()
			mqttPool.disconnectAll()
			logger.info('Scrobbler stopped')
		},
	}
}
