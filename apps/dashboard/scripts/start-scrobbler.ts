#!/usr/bin/env tsx
import { configStore } from '../lib/config-store'
import { getLatestSettingUpdatedAt } from '../lib/db/queries'
import { logger } from '../lib/logger'
import { syncRetroAchievements } from '../lib/retroachievements/sync'
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

	// RA background sync — runs on a configurable interval
	function scheduleRaSync() {
		const cfg = configStore.get().retroachievements
		if (!cfg.enabled) return
		const intervalMs = cfg.autoSyncMinutes * 60 * 1000
		return setInterval(async () => {
			if (!configStore.get().retroachievements.enabled) return
			try {
				await syncRetroAchievements()
			} catch (err) {
				logger.error('RA background sync failed', err)
			}
		}, intervalMs)
	}

	let raSyncInterval = scheduleRaSync()

	configStore.on('changed:retroachievements', () => {
		if (raSyncInterval) clearInterval(raSyncInterval)
		raSyncInterval = scheduleRaSync()
	})

	const shutdown = async (signal: string) => {
		logger.info(`Received ${signal}, shutting down...`)
		clearInterval(configPollInterval)
		if (raSyncInterval) clearInterval(raSyncInterval)
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
