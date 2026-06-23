import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { AGENT_LIVENESS_MS, getAgentLastSeen } from '@/lib/db/agent-liveness'
import { getAllNowPlaying, nowPlayingToEvent } from '@/lib/db/now-playing'
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
// Vercel caps a streaming function's lifetime; ask for the max (capped to the
// plan). We self-close a bit before this so the client reconnects on a clean EOF
// instead of an abrupt platform kill mid-message.
export const maxDuration = 300

export async function GET(request: Request) {
	if (!(await getUser())) return unauthorized()
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

			const recalboxIds = configStore.getRecalboxes().flatMap((r) => (r.archived ? [] : [r.id]))
			const cleanups: Array<() => void> = []
			const clients = new Map<string, RecalboxMqttClient>()

			for (const recalboxId of recalboxIds) {
				let client: RecalboxMqttClient
				try {
					client = mqttPool.getClient(recalboxId)
				} catch {
					continue
				}

				clients.set(recalboxId, client)

				sendConnectionStatus(recalboxId, client.isConnected)
				if (!recalboxIdFilter || recalboxIdFilter === recalboxId) {
					if (client.lastKnownGame) {
						sendEvent(recalboxId, client.lastKnownGame)
					} else if (client.lastKnownScreensaverGame) {
						sendEvent(recalboxId, client.lastKnownScreensaverGame)
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

			// Relay the agent-pushed now_playing row (serverless: cloud has no MQTT link to the box).
			const nowPlayingState = new Map<string, string | null>()
			const pollNowPlaying = async () => {
				try {
					for (const row of await getAllNowPlaying(db)) {
						if (recalboxIdFilter && recalboxIdFilter !== row.recalboxId) continue
						// When a live MQTT link exists for this box, let MQTT drive (avoid a double source).
						if (clients.get(row.recalboxId)?.isConnected) continue
						const key = row.playing ? (row.romPath ?? '') : null
						if (nowPlayingState.get(row.recalboxId) === key) continue
						nowPlayingState.set(row.recalboxId, key)
						sendEvent(row.recalboxId, nowPlayingToEvent(row))
					}
				} catch (err) {
					logger.error('Now-playing poll failed', err)
				}
			}
			const nowPlayingPollInterval = setInterval(pollNowPlaying, 5000)
			pollNowPlaying()

			// Serverless connection status: with no cloud→box MQTT, derive online from the
			// agent's recency (token lastUsedAt). Only for boxes whose MQTT isn't connected.
			const connOnline = new Map<string, boolean>()
			const pollConnection = async () => {
				try {
					const lastSeen = await getAgentLastSeen(db)
					const now = Date.now()
					for (const recalboxId of recalboxIds) {
						if (recalboxIdFilter && recalboxIdFilter !== recalboxId) continue
						if (clients.get(recalboxId)?.isConnected) continue
						const seen = lastSeen.get(recalboxId)
						const online = seen ? now - seen.getTime() < AGENT_LIVENESS_MS : false
						if (connOnline.get(recalboxId) === online) continue
						connOnline.set(recalboxId, online)
						sendConnectionStatus(recalboxId, online)
					}
				} catch (err) {
					logger.error('Connection liveness poll failed', err)
				}
			}
			const connectionPollInterval = setInterval(pollConnection, 5000)
			pollConnection()

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

			// Reconnect proactively before the platform kills a long stream.
			const lifespan = setTimeout(
				() => {
					try {
						controller.close()
					} catch {}
				},
				(maxDuration - 10) * 1000,
			)

			request.signal.addEventListener('abort', () => {
				clearInterval(heartbeat)
				clearInterval(pollInterval)
				clearInterval(feedbackPollInterval)
				clearInterval(nowPlayingPollInterval)
				clearInterval(connectionPollInterval)
				clearTimeout(lifespan)
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
