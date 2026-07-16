import { getViewableRecalboxIds } from '@/lib/auth/ownership'
import { loadRecalboxes } from '@/lib/auth/recalbox-acl'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { AGENT_LIVENESS_MS, getAgentLastSeen } from '@/lib/db/agent-liveness'
import { getAllNowPlaying, nowPlayingToEvent } from '@/lib/db/now-playing'
import { getLatestSnapshots, snapshotToSystemInfo } from '@/lib/db/system-info'
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
import { isServerlessMode } from '@/lib/serverless'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Vercel caps a streaming function's lifetime; ask for the max (capped to the
// plan). We self-close a bit before this so the client reconnects on a clean EOF
// instead of an abrupt platform kill mid-message.
export const maxDuration = 300

// Each open SSE stream re-runs these DB polls for its whole lifetime, so every
// tab is a steady Turso read load. On the serverless/Turso backend that is a real
// quota cost (an idle tab left open all day = tens of thousands of reads), so the
// intervals are deliberately relaxed — a few seconds of extra lag on a status
// pill or the temperature gauge is invisible, but it cuts the read rate ~4×.
// Live game start/stop still arrives promptly (10s) so the now-playing card feels
// responsive; the slow-moving signals (connection, CPU/temp) poll least often.
const NOW_PLAYING_POLL_MS = 10_000
const NOTIFICATIONS_POLL_MS = 20_000
// connection + system-info + feedback are batched into ONE loop (was three timers).
const SLOW_POLL_MS = 30_000
// Idle backoff (serverless only): no game playing and no box online, so widen every
// loop — the on-box agent only pushes every few minutes; faster polling buys nothing.
const IDLE_NOW_PLAYING_MS = 30_000
const IDLE_SLOW_POLL_MS = 60_000

export async function GET(request: Request) {
	const user = await getUser()
	if (!user) return unauthorized()

	// Authorization, not just authentication. Every source feeding this stream
	// (now_playing, agent tokens, snapshots, the box list) queries the WHOLE table,
	// so without this gate any signed-in user received the live game, CPU/temp and
	// online status of every OTHER user's box.
	const viewable = new Set(await getViewableRecalboxIds(user))

	const url = new URL(request.url)
	const recalboxIdFilter = url.searchParams.get('recalboxId')
	// Asking for a box you cannot see is a 403, not an empty stream — an empty
	// stream is indistinguishable from "box is idle" and would hide the refusal.
	if (recalboxIdFilter && !viewable.has(recalboxIdFilter)) return forbidden()

	// The UI filter narrows to the active box; `viewable` is the security boundary
	// and always applies. Kept separate on purpose: a user with several boxes must
	// still receive NOTIFICATIONS from the non-active ones (the bell is cross-box),
	// while the activity state — which collapses into ONE global client state — must
	// only ever reflect the box being looked at.
	const allowed = (recalboxId: string) =>
		viewable.has(recalboxId) && (!recalboxIdFilter || recalboxIdFilter === recalboxId)

	// Read from the DB (not configStore, whose rows go stale per serverless instance)
	// and keep only what this user may see.
	const recalboxIds = (await loadRecalboxes()).flatMap((r) =>
		r.archived || !viewable.has(r.id) ? [] : [r.id],
	)

	const notifService = getNotificationService()

	const stream = new ReadableStream({
		start(controller) {
			const encode = (chunk: string) => new TextEncoder().encode(chunk)

			const sendEvent = (recalboxId: string, event: RecalboxEvent) => {
				if (!allowed(recalboxId)) return
				try {
					controller.enqueue(encode(`data: ${JSON.stringify({ ...event, recalboxId })}\n\n`))
				} catch (err) {
					logger.info('SSE enqueue failed (client likely disconnected)', err)
				}
			}

			// Box-scoped notifications go only to users who can see that box; a null
			// recalboxId is a global notification and stays broadcast, as before.
			const maySeeNotification = (notif: Notification) =>
				notif.recalboxId == null || viewable.has(notif.recalboxId)

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
				if (!allowed(recalboxId)) return
				try {
					controller.enqueue(
						encode(`data: ${JSON.stringify({ type: 'connection', online, recalboxId })}\n\n`),
					)
				} catch (err) {
					logger.info('SSE connection status enqueue failed (client likely disconnected)', err)
				}
			}

			const cleanups: Array<() => void> = []
			const clients = new Map<string, RecalboxMqttClient>()

			// Serverless: the cloud has no MQTT link to the (NAT'd) box, so a cloud MQTT
			// client would only ever emit connection:down and fight the agent-liveness
			// signal below. Skip it entirely — pollConnection + pollNowPlaying drive the UI.
			if (!isServerlessMode())
				for (const recalboxId of recalboxIds) {
					let client: RecalboxMqttClient
					try {
						client = mqttPool.getClient(recalboxId)
					} catch {
						continue
					}

					clients.set(recalboxId, client)

					sendConnectionStatus(recalboxId, client.isConnected)
					if (allowed(recalboxId)) {
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

			// The maySeeNotification() guards must come BEFORE markPushedInApp(), which
			// atomically CLAIMS the notification: an unauthorized stream would otherwise
			// burn the claim and the rightful owner would never be notified at all.
			const onNotificationCreated = (notif: Notification) => {
				if (!maySeeNotification(notif)) return
				notifService.markPushedInApp(notif.id).then((claimed) => {
					if (claimed) sendNotification(notif)
				})
			}
			notifService.on('created', onNotificationCreated)

			const pollNotifications = async () => {
				try {
					const unpushed = await notifService.getUnpushedInApp(0)
					for (const notif of unpushed) {
						if (!maySeeNotification(notif)) continue
						const claimed = await notifService.markPushedInApp(notif.id)
						if (claimed) sendNotification(notif)
					}
				} catch (err) {
					logger.error('Notification poll failed', err)
				}
			}
			const pollInterval = setInterval(pollNotifications, NOTIFICATIONS_POLL_MS)

			// Relay the agent-pushed now_playing row (serverless: cloud has no MQTT link to the box).
			const nowPlayingState = new Map<string, string | null>()
			const pollNowPlaying = async () => {
				try {
					for (const row of await getAllNowPlaying(db)) {
						if (!allowed(row.recalboxId)) continue
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

			// Serverless connection status: with no cloud→box MQTT, derive online from the
			// agent's recency (token lastUsedAt). Only for boxes whose MQTT isn't connected.
			const connOnline = new Map<string, boolean>()
			const pollConnection = async () => {
				try {
					const lastSeen = await getAgentLastSeen(db)
					const now = Date.now()
					// getAgentLastSeen() spans every box in the deployment, so allowed()
					// (not just the UI filter) decides what leaves this loop.
					const ids = new Set<string>([...recalboxIds, ...lastSeen.keys()])
					for (const recalboxId of ids) {
						if (!allowed(recalboxId)) continue
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

			// Serverless system stats: emit system:info from the latest agent snapshot
			// (the cloud has no MQTT to read CPU/temp live). Only for MQTT-disconnected boxes.
			const systemInfoState = new Map<string, number>()
			const pollSystemInfo = async () => {
				try {
					for (const [recalboxId, row] of await getLatestSnapshots(db)) {
						if (!allowed(recalboxId)) continue
						if (clients.get(recalboxId)?.isConnected) continue
						if (systemInfoState.get(recalboxId) === row.id) continue
						systemInfoState.set(recalboxId, row.id)
						sendEvent(recalboxId, snapshotToSystemInfo(row))
					}
				} catch (err) {
					logger.error('System-info poll failed', err)
				}
			}

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
			// Batched, adaptive polling. The three slow signals (connection, system stats,
			// feedback) share ONE loop instead of three timers; now-playing keeps its own.
			// When serverless AND idle (nothing playing, no box online) both loops back off
			// — the on-box agent only pushes every few minutes, so tighter polling would
			// just burn Fluid Active CPU / Turso reads and hold the instance warm for nothing.
			let closed = false
			const anyGameActive = () => {
				for (const key of nowPlayingState.values()) if (key !== null) return true
				return false
			}
			const anyBoxOnline = () => {
				for (const c of clients.values()) if (c.isConnected) return true
				for (const online of connOnline.values()) if (online) return true
				return false
			}
			const idle = () => isServerlessMode() && !anyGameActive() && !anyBoxOnline()

			let nowPlayingTimer: ReturnType<typeof setTimeout>
			const loopNowPlaying = async () => {
				await pollNowPlaying()
				if (closed) return
				nowPlayingTimer = setTimeout(
					loopNowPlaying,
					idle() ? IDLE_NOW_PLAYING_MS : NOW_PLAYING_POLL_MS,
				)
			}

			let slowTimer: ReturnType<typeof setTimeout>
			const loopSlow = async () => {
				await pollConnection()
				await pollSystemInfo()
				await pollFeedback()
				if (closed) return
				slowTimer = setTimeout(loopSlow, idle() ? IDLE_SLOW_POLL_MS : SLOW_POLL_MS)
			}

			loopNowPlaying()
			loopSlow()

			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encode(': heartbeat\n\n'))
				} catch {
					clearInterval(heartbeat)
				}
			}, 15000)

			// Single teardown path. A clean server-side self-close does NOT reliably fire
			// request 'abort', so BOTH the lifespan timeout and the abort listener funnel
			// through here — otherwise a self-closed stream would leak pollInterval (a 20s
			// DB poll), the MQTT listeners in `cleanups`, and the notifService listener on
			// every ~290s reconnect. Idempotent via `torn`.
			let torn = false
			const teardown = () => {
				if (torn) return
				torn = true
				closed = true
				clearInterval(heartbeat)
				clearInterval(pollInterval)
				clearTimeout(nowPlayingTimer)
				clearTimeout(slowTimer)
				clearTimeout(lifespan)
				for (const cleanup of cleanups) cleanup()
				notifService.off('created', onNotificationCreated)
			}

			// Reconnect proactively before the platform kills a long stream.
			const lifespan = setTimeout(
				() => {
					teardown()
					try {
						controller.close()
					} catch {}
				},
				(maxDuration - 10) * 1000,
			)

			request.signal.addEventListener('abort', () => {
				teardown()
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
