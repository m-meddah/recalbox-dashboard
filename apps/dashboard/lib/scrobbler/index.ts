import { db } from '@/lib/db/index'
import { logger } from '@/lib/logger'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'
import { getMqttClient } from '@/lib/recalbox/mqtt-client'
import { SessionManager } from './session-manager'

export type Scrobbler = {
	stop: () => Promise<void>
}

export async function startScrobbler(): Promise<Scrobbler> {
	const manager = new SessionManager(db)
	const mqttClient = getMqttClient()

	const recovered = await manager.recoverOrphanSessions()
	if (recovered > 0) {
		logger.info(`Recovered ${recovered} orphan session(s) from previous run`)
	}

	const onGameStart = async (event: GameStartEvent) => {
		try {
			await manager.openSession(event)
		} catch (err) {
			logger.error('Error opening session', err)
		}
	}

	const onGameStop = async (event: GameStopEvent) => {
		try {
			await manager.closeSession(event)
		} catch (err) {
			logger.error('Error closing session', err)
		}
	}

	mqttClient.on('game:start', onGameStart)
	mqttClient.on('game:stop', onGameStop)

	mqttClient.connect()
	logger.info('Scrobbler listening for game events')

	return {
		stop: async () => {
			mqttClient.off('game:start', onGameStart)
			mqttClient.off('game:stop', onGameStop)
			await manager.closeAllOpenSessions('daemon_shutdown')
			mqttClient.disconnect()
			logger.info('Scrobbler stopped')
		},
	}
}
