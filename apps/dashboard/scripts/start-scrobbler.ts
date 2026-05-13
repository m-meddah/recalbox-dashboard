#!/usr/bin/env tsx
import { startScrobbler } from '../lib/scrobbler'
import { logger } from '../lib/logger'

async function main() {
	logger.info('Starting Recalbox scrobbler daemon...')
	const scrobbler = await startScrobbler()

	const shutdown = async (signal: string) => {
		logger.info(`Received ${signal}, shutting down...`)
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
