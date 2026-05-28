import { configStore } from '@/lib/config-store'
import { feedbackService } from '@/lib/feedback/service'
import { logger } from '@/lib/logger'
import { getNotificationService } from '@/lib/notifications/service'
import type { Notification } from '@/lib/notifications/types'
import type {
	GameStartEvent,
	GameStopEvent,
	RecalboxEvent,
	ScreensaverStartEvent,
	ScreensaverStopEvent,
	SystemChangeEvent,
	SystemInfoEvent,
} from '@/lib/recalbox/events'
import { mqttPool } from '@/lib/recalbox/mqtt-client'
import type { RecalboxMqttClient } from '@/lib/recalbox/mqtt-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
	const url = new URL(request.url)
	const recalboxIdFilter = url.searchParams.get('recalboxId')
	const notifService = getNotificationService()

	const stream = new ReadableStream({
		start(controller) {
			const encode = (chunk: string) => new TextEncoder().encode(chunk)

			const sendEvent = (recalboxId: string, event: RecalboxEvent) => {
				if (recalboxIdFilter && recalboxIdFilter !== recalboxId) return
				try {
					controller.enqueue(encode(`data: ${JSON.stringify({ ...event, recalboxId })}\n\n`))
				} catch (err) {
					logger.info('SSE enqueue failed (client likely disconnected)', err)
				}
			}

			const sendNotification = (notif: Notification) => {
				try {
					controller.enqueue(
						encode(`data: ${JSON.stringify({ type: 'notification', notification: notif })}\n\n`),
					)
				} catch (err) {
					logger.info('SSE notification enqueue failed (client likely disconnected)', err)
				}
			}

			const sendConnectionStatus = (recalboxId: string, online: boolean) => {
				if (recalboxIdFilter && recalboxIdFilter !== recalboxId) return
				try {
					controller.enqueue(
						encode(`data: ${JSON.stringify({ type: 'connection', online, recalboxId })}\n\n`),
					)
				} catch (err) {
					logger.info('SSE connection status enqueue failed (client likely disconnected)', err)
				}
			}

			const recalboxIds = configStore
				.getRecalboxes()
				.filter((r) => !r.archived)
				.map((r) => r.id)
			const cleanups: Array<() => void> = []

			for (const recalboxId of recalboxIds) {
				let client: RecalboxMqttClient
				try {
					client = mqttPool.getClient(recalboxId)
				} catch {
					continue
				}

				sendConnectionStatus(recalboxId, client.isConnected)
				if (!recalboxIdFilter || recalboxIdFilter === recalboxId) {
					if (client.lastKnownGame) {
						sendEvent(recalboxId, client.lastKnownGame)
					} else if (client.isScreensaverActive) {
						sendEvent(recalboxId, { type: 'screensaver:start' })
					} else if (client.lastKnownBrowsing) {
						sendEvent(recalboxId, client.lastKnownBrowsing)
					}
				}

				const onGameStart = (e: GameStartEvent) => sendEvent(recalboxId, e)
				const onGameStop = (e: GameStopEvent) => sendEvent(recalboxId, e)
				const onSystemChange = (e: SystemChangeEvent) => sendEvent(recalboxId, e)
				const onSystemInfo = (e: SystemInfoEvent) => sendEvent(recalboxId, e)
				const onScreensaverStart = (e: ScreensaverStartEvent) => sendEvent(recalboxId, e)
				const onScreensaverStop = (e: ScreensaverStopEvent) => sendEvent(recalboxId, e)
				const onUp = () => sendConnectionStatus(recalboxId, true)
				const onDown = () => sendConnectionStatus(recalboxId, false)

				client.on('game:start', onGameStart)
				client.on('game:stop', onGameStop)
				client.on('system:change', onSystemChange)
				client.on('system:info', onSystemInfo)
				client.on('screensaver:start', onScreensaverStart)
				client.on('screensaver:stop', onScreensaverStop)
				client.on('connection:up', onUp)
				client.on('connection:down', onDown)

				cleanups.push(() => {
					client.off('game:start', onGameStart)
					client.off('game:stop', onGameStop)
					client.off('system:change', onSystemChange)
					client.off('system:info', onSystemInfo)
					client.off('screensaver:start', onScreensaverStart)
					client.off('screensaver:stop', onScreensaverStop)
					client.off('connection:up', onUp)
					client.off('connection:down', onDown)
				})
			}

			const onNotificationCreated = (notif: Notification) => {
				notifService.markPushedInApp(notif.id).then((claimed) => {
					if (claimed) sendNotification(notif)
				})
			}
			notifService.on('created', onNotificationCreated)

			const pollNotifications = async () => {
				try {
					const unpushed = await notifService.getUnpushedInApp(0)
					for (const notif of unpushed) {
						const claimed = await notifService.markPushedInApp(notif.id)
						if (claimed) sendNotification(notif)
					}
				} catch (err) {
					logger.error('Notification poll failed', err)
				}
			}
			const pollInterval = setInterval(pollNotifications, 5000)

			const sendFeedback = (feedbackId: number) => {
				try {
					controller.enqueue(
						encode(`data: ${JSON.stringify({ type: 'feedback:new', feedbackId })}\n\n`),
					)
				} catch (err) {
					logger.info('SSE feedback enqueue failed (client likely disconnected)', err)
				}
			}

			const pollFeedback = async () => {
				try {
					const unpushed = await feedbackService.getUnpushed()
					for (const f of unpushed) {
						await feedbackService.markPushed(f.id)
						sendFeedback(f.id)
					}
				} catch (err) {
					logger.error('Feedback poll failed', err)
				}
			}
			const feedbackPollInterval = setInterval(pollFeedback, 5000)
			pollFeedback()

			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encode(': heartbeat\n\n'))
				} catch {
					clearInterval(heartbeat)
				}
			}, 15000)

			request.signal.addEventListener('abort', () => {
				clearInterval(heartbeat)
				clearInterval(pollInterval)
				clearInterval(feedbackPollInterval)
				for (const cleanup of cleanups) cleanup()
				notifService.off('created', onNotificationCreated)
				controller.close()
			})
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		},
	})
}
