'use client'

import type { Notification } from '@/lib/notifications/types'
import type {
	GameStartEvent,
	GameStopEvent,
	RecalboxEvent,
	SystemChangeEvent,
	SystemInfoEvent,
} from '@/lib/recalbox/events'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ConnectionEvent = { type: 'connection'; online: boolean }
export type NotificationSSEEvent = { type: 'notification'; notification: Notification }
export type FeedbackNewEvent = { type: 'feedback:new'; feedbackId: number }
export type SSEEvent = RecalboxEvent | ConnectionEvent | NotificationSSEEvent | FeedbackNewEvent

type Handler = (event: SSEEvent) => void

export type ActivityState = {
	game: GameStartEvent | null
	screensaver: boolean
	browsing: SystemChangeEvent | null
	lastSystemInfo: SystemInfoEvent | null
}

type RecalboxEventsContextValue = {
	mqttOnline: boolean | null
	/** Last known activity state — available immediately on mount for newly-navigated components. */
	activity: ActivityState
	/** Subscribe to all SSE events. Returns an unsubscribe function. */
	subscribe: (handler: Handler) => () => void
}

const initialActivity: ActivityState = {
	game: null,
	screensaver: false,
	browsing: null,
	lastSystemInfo: null,
}

const RecalboxEventsContext = createContext<RecalboxEventsContextValue>({
	mqttOnline: null,
	activity: initialActivity,
	subscribe: () => () => {},
})

export function RecalboxEventsProvider({ children }: { children: React.ReactNode }) {
	const [mqttOnline, setMqttOnline] = useState<boolean | null>(null)
	const [activity, setActivity] = useState<ActivityState>(initialActivity)
	const handlersRef = useRef<Set<Handler> | null>(null)
	if (handlersRef.current === null) handlersRef.current = new Set()
	const esRef = useRef<EventSource | null>(null)

	useEffect(() => {
		let reconnectTimer: ReturnType<typeof setTimeout>

		function connect() {
			const es = new EventSource('/api/events')
			esRef.current = es

			es.onmessage = (e: MessageEvent<string>) => {
				let event: SSEEvent
				try {
					event = JSON.parse(e.data) as SSEEvent
				} catch {
					return
				}

				if (event.type === 'connection') {
					setMqttOnline(event.online)
				} else if (event.type === 'game:start') {
					const ev = event as GameStartEvent
					setActivity((prev) => ({
						...prev,
						game: { ...ev, startedAt: new Date(ev.startedAt) },
						screensaver: false,
					}))
				} else if (event.type === 'game:stop') {
					const ev = event as GameStopEvent
					setActivity((prev) => ({
						...prev,
						game: prev.game?.romPath === ev.romPath ? null : prev.game,
					}))
				} else if (event.type === 'system:change') {
					const ev = event as SystemChangeEvent
					setActivity((prev) => ({
						...prev,
						browsing: ev,
						screensaver: false,
						game: prev.game?.fromScreensaver ? null : prev.game,
					}))
				} else if (event.type === 'screensaver:start') {
					setActivity((prev) => ({ ...prev, screensaver: true }))
				} else if (event.type === 'screensaver:stop') {
					setActivity((prev) => ({
						...prev,
						screensaver: false,
						game: prev.game?.fromScreensaver ? null : prev.game,
					}))
				} else if (event.type === 'system:info') {
					setActivity((prev) => ({ ...prev, lastSystemInfo: event as SystemInfoEvent }))
				}

				for (const handler of handlersRef.current ?? []) {
					handler(event)
				}
			}

			es.onerror = () => {
				es.close()
				esRef.current = null
				reconnectTimer = setTimeout(connect, 3000)
			}
		}

		connect()

		return () => {
			clearTimeout(reconnectTimer)
			esRef.current?.close()
		}
	}, [])

	const subscribe = useCallback((handler: Handler) => {
		handlersRef.current?.add(handler)
		return () => {
			handlersRef.current?.delete(handler)
		}
	}, [])

	const contextValue = useMemo(
		() => ({ mqttOnline, activity, subscribe }),
		[mqttOnline, activity, subscribe],
	)

	return (
		<RecalboxEventsContext.Provider value={contextValue}>{children}</RecalboxEventsContext.Provider>
	)
}

export function useRecalboxEvents() {
	return use(RecalboxEventsContext)
}
