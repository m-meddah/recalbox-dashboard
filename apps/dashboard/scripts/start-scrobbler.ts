#!/usr/bin/env tsx
import { CronJob } from 'cron'
import { configStore } from '../lib/config-store'
import { getLatestSettingUpdatedAt } from '../lib/db/queries'
import { cleanupExpiredFeedback } from '../lib/feedback/cleanup'
import { logger } from '../lib/logger'
import { notificationService } from '../lib/notifications/service'
import { getOrCreateVapidKeys } from '../lib/notifications/vapid'
import { sendWebPush } from '../lib/notifications/web-push'
import { startProfileScheduler } from '../lib/profile/scheduler'
import { syncRetroAchievements } from '../lib/retroachievements/sync'
import { startScrobbler } from '../lib/scrobbler'
import type { Scrobbler } from '../lib/scrobbler'

// tsx watch does in-process hot-reload: globalThis survives but module cache is cleared.
// Without this, each reload calls startScrobbler() again and accumulates MQTT listeners.
const g = globalThis as typeof globalThis & { __scrobbler?: Scrobbler }

async function main() {
	if (g.__scrobbler) {
		logger.info('Hot-reload detected: stopping previous scrobbler instance...')
		await g.__scrobbler.stop()
		g.__scrobbler = undefined
	}

	logger.info('Starting Recalbox scrobbler daemon...')

	// Ensure VAPID keys exist (auto-generate if absent)
	try {
		await getOrCreateVapidKeys()
		logger.info('VAPID keys ready')
	} catch (err) {
		logger.warn('Failed to initialize VAPID keys', err)
	}
	const scrobbler = await startScrobbler()
	g.__scrobbler = scrobbler

	// Cleanup expired feedback entries at startup and hourly
	cleanupExpiredFeedback()
		.then((n) => {
			if (n > 0) logger.info(`[feedback] Startup cleanup: removed ${n} expired entries`)
		})
		.catch((err) => logger.error('[feedback] Startup cleanup failed', err))

	const feedbackCleanupInterval = setInterval(
		() => {
			cleanupExpiredFeedback()
				.then((n) => {
					if (n > 0) logger.info(`[feedback] Hourly cleanup: removed ${n} expired entries`)
				})
				.catch((err) => logger.error('[feedback] Hourly cleanup failed', err))
		},
		60 * 60 * 1000,
	)

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

	// Profile recompute — startup + every 6h
	startProfileScheduler()

	// Wrapped available — fires December 1st at 9am
	const wrappedCron = new CronJob(
		'0 9 1 12 *',
		async () => {
			const year = new Date().getFullYear() - 1
			logger.info(`Sending Wrapped available notification for ${year}`)
			const notif = await notificationService.create({ type: 'wrapped.available', data: { year } })
			if (notif) sendWebPush(notif).catch(() => {})
		},
		null,
		true,
	)

	const shutdown = async (signal: string) => {
		logger.info(`Received ${signal}, shutting down...`)
		wrappedCron.stop()
		clearInterval(configPollInterval)
		clearInterval(feedbackCleanupInterval)
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
