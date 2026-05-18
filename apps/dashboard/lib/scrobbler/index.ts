import { db } from '@/lib/db/index'
import { logger } from '@/lib/logger'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'
import { mqttPool, getMqttClientFor } from '@/lib/recalbox/mqtt-client'
import { configStore } from '@/lib/config-store'
import { SessionManager } from './session-manager'

export type Scrobbler = { stop: () => Promise<void> }

export async function startScrobbler(): Promise<Scrobbler> {
	const manager = new SessionManager(db)
	const recovered = await manager.recoverOrphanSessions()
	if (recovered > 0) logger.info(`Recovered ${recovered} orphan session(s)`)

	const subscriptions = new Map<string, { start: (e: GameStartEvent) => void; stop: (e: GameStopEvent) => void }>()

	function subscribeToRecalbox(recalboxId: string): void {
		if (subscriptions.has(recalboxId)) return
		const client = getMqttClientFor(recalboxId)
		client.connect()

		const onStart = async (event: GameStartEvent) => {
			try { await manager.openSession(event, recalboxId) } catch (err) { logger.error(`Error opening session [${recalboxId}]`, err) }
		}
		const onStop = async (event: GameStopEvent) => {
			try { await manager.closeSession(event) } catch (err) { logger.error(`Error closing session [${recalboxId}]`, err) }
		}

		client.on('game:start', onStart)
		client.on('game:stop', onStop)
		subscriptions.set(recalboxId, { start: onStart, stop: onStop })
		logger.info(`Scrobbler subscribed to Recalbox ${recalboxId}`)
	}

	function unsubscribeFromRecalbox(recalboxId: string): void {
		const handlers = subscriptions.get(recalboxId)
		if (!handlers) return
		try {
			const client = getMqttClientFor(recalboxId)
			client.off('game:start', handlers.start)
			client.off('game:stop', handlers.stop)
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
	configStore.on('recalbox:added', onAdded)
	configStore.on('recalbox:removed', onRemoved)

	logger.info('Scrobbler listening for game events on all Recalboxes')

	return {
		stop: async () => {
			configStore.off('recalbox:added', onAdded)
			configStore.off('recalbox:removed', onRemoved)
			for (const id of subscriptions.keys()) unsubscribeFromRecalbox(id)
			await manager.closeAllOpenSessions('daemon_shutdown')
			mqttPool.disconnectAll()
			logger.info('Scrobbler stopped')
		},
	}
}
