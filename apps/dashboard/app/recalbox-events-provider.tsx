'use client'

import type { Notification } from '@/lib/notifications/types'
import type { RecalboxEvent } from '@/lib/recalbox/events'
import { createContext, use, useCallback, useEffect, useRef, useState } from 'react'

export type ConnectionEvent = { type: 'connection'; online: boolean }
export type NotificationSSEEvent = { type: 'notification'; notification: Notification }
export type FeedbackNewEvent = { type: 'feedback:new'; feedbackId: number }
export type SSEEvent = RecalboxEvent | ConnectionEvent | NotificationSSEEvent | FeedbackNewEvent

type Handler = (event: SSEEvent) => void

type RecalboxEventsContextValue = {
	mqttOnline: boolean | null
	/** Subscribe to all SSE events. Returns an unsubscribe function. */
	subscribe: (handler: Handler) => () => void
}

const RecalboxEventsContext = createContext<RecalboxEventsContextValue>({
	mqttOnline: null,
	subscribe: () => () => {},
})

export function RecalboxEventsProvider({ children }: { children: React.ReactNode }) {
	const [mqttOnline, setMqttOnline] = useState<boolean | null>(null)
	const handlersRef = useRef<Set<Handler>>(new Set())
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
				}

				for (const handler of handlersRef.current) {
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
		handlersRef.current.add(handler)
		return () => {
			handlersRef.current.delete(handler)
		}
	}, [])

	return (
		<RecalboxEventsContext.Provider value={{ mqttOnline, subscribe }}>
			{children}
		</RecalboxEventsContext.Provider>
	)
}

export function useRecalboxEvents() {
	return use(RecalboxEventsContext)
}
