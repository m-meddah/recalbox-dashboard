import { getMqttClient } from '@/lib/recalbox/mqtt-client'
import type { RecalboxEvent } from '@/lib/recalbox/events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
	const mqttClient = getMqttClient()

	const stream = new ReadableStream({
		start(controller) {
			const encode = (chunk: string) => new TextEncoder().encode(chunk)

			const sendEvent = (event: RecalboxEvent) => {
				try {
					controller.enqueue(encode(`data: ${JSON.stringify(event)}\n\n`))
				} catch {
					// Client already disconnected
				}
			}

			const sendConnectionStatus = (online: boolean) => {
				try {
					controller.enqueue(
						encode(`data: ${JSON.stringify({ type: 'connection', online })}\n\n`),
					)
				} catch {
					// Client already disconnected
				}
			}

			// ── Send current state immediately so new clients don't wait ──────────
			sendConnectionStatus(mqttClient.isConnected)
			if (mqttClient.lastKnownGame) {
				sendEvent(mqttClient.lastKnownGame)
			}

			// ── Subscribe to future events ────────────────────────────────────────
			const onConnectionUp = () => sendConnectionStatus(true)
			const onConnectionDown = () => sendConnectionStatus(false)

			mqttClient.on('game:start', sendEvent)
			mqttClient.on('game:stop', sendEvent)
			mqttClient.on('system:change', sendEvent)
			mqttClient.on('system:info', sendEvent)
			mqttClient.on('connection:up', onConnectionUp)
			mqttClient.on('connection:down', onConnectionDown)

			// Keep connection alive — proxies and Next.js dev server drop idle SSE streams
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encode(': heartbeat\n\n'))
				} catch {
					clearInterval(heartbeat)
				}
			}, 15000)

			request.signal.addEventListener('abort', () => {
				clearInterval(heartbeat)
				mqttClient.off('game:start', sendEvent)
				mqttClient.off('game:stop', sendEvent)
				mqttClient.off('system:change', sendEvent)
				mqttClient.off('system:info', sendEvent)
				mqttClient.off('connection:up', onConnectionUp)
				mqttClient.off('connection:down', onConnectionDown)
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
