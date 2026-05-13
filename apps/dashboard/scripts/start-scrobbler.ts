#!/usr/bin/env tsx
import { configStore } from '../lib/config-store'
import { getLatestSettingUpdatedAt } from '../lib/db/queries'
import { logger } from '../lib/logger'
import { startScrobbler } from '../lib/scrobbler'

async function main() {
	logger.info('Starting Recalbox scrobbler daemon...')
	const scrobbler = await startScrobbler()

	// Initialize config and track last known update timestamp
	configStore.get()
	let lastUpdatedAt = getLatestSettingUpdatedAt()

	const configPollInterval = setInterval(() => {
		try {
			const latest = getLatestSettingUpdatedAt()
			if (latest > lastUpdatedAt) {
				lastUpdatedAt = latest
				logger.info('Scrobbler: config change detected, reloading...')
				configStore.reload()
			}
		} catch (err) {
			logger.error('Scrobbler: error polling config', err)
		}
	}, 30_000)

	const shutdown = async (signal: string) => {
		logger.info(`Received ${signal}, shutting down...`)
		clearInterval(configPollInterval)
		await scrobbler.stop()
		process.exit(0)
	}

	process.on('SIGTERM', () => shutdown('SIGTERM'))
	process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
	logger.error('Fatal error in scrobbler', err)
	process.exit(1)
})
