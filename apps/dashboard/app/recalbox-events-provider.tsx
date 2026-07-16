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

/** Live state plus the box it describes, so staleness is derivable rather than reset. */
type StreamState = { box: string | null; activity: ActivityState; mqttOnline: boolean | null }

const initialStream: StreamState = { box: null, activity: initialActivity, mqttOnline: null }

/** Fold one box-scoped event into the state. Pure — no reset logic, no effects. */
function applyEvent(state: StreamState, event: SSEEvent): StreamState {
	const set = (activity: ActivityState) => ({ ...state, activity })

	if (event.type === 'connection') return { ...state, mqttOnline: event.online }
	if (event.type === 'game:start') {
		const ev = event as GameStartEvent
		return set({
			...state.activity,
			game: { ...ev, startedAt: new Date(ev.startedAt) },
			screensaver: false,
		})
	}
	if (event.type === 'game:stop') {
		const ev = event as GameStopEvent
		return set({
			...state.activity,
			game: state.activity.game?.romPath === ev.romPath ? null : state.activity.game,
		})
	}
	if (event.type === 'system:change') {
		return set({
			...state.activity,
			browsing: event as SystemChangeEvent,
			screensaver: false,
			game: state.activity.game?.fromScreensaver ? null : state.activity.game,
		})
	}
	if (event.type === 'screensaver:start') return set({ ...state.activity, screensaver: true })
	if (event.type === 'screensaver:stop') {
		return set({
			...state.activity,
			screensaver: false,
			game: state.activity.game?.fromScreensaver ? null : state.activity.game,
		})
	}
	if (event.type === 'system:info') {
		return set({ ...state.activity, lastSystemInfo: event as SystemInfoEvent })
	}
	return state
}

/**
 * @param recalboxId Active box. The stream is narrowed to it because every activity
 * signal below collapses into ONE global state — unfiltered, a second box's events
 * would overwrite the box actually being viewed (last writer wins). Notifications are
 * exempt server-side and keep arriving from all of the user's boxes. Null means "no
 * box selected": stay unfiltered rather than subscribing to nothing.
 */
export function RecalboxEventsProvider({
	children,
	recalboxId = null,
}: { children: React.ReactNode; recalboxId?: string | null }) {
	// The stream state carries the box it came FROM. Nothing resets it on a box
	// switch: state belonging to another box is simply not read (see `stale` below),
	// which also means a late event from the closed stream cannot pollute the new
	// box's view — it lands tagged with the old id and is ignored.
	const [stream, setStream] = useState<StreamState>(initialStream)
	const handlersRef = useRef<Set<Handler> | null>(null)
	if (handlersRef.current === null) handlersRef.current = new Set()
	const esRef = useRef<EventSource | null>(null)

	// If no connection event arrives within 10 s (SSE failing or no Recalbox configured),
	// fall through to offline so components don't stay in perpetual skeleton state.
	useEffect(() => {
		const fallback = setTimeout(() => {
			setStream((prev) => (prev.mqttOnline === null ? { ...prev, mqttOnline: false } : prev))
		}, 10_000)
		return () => clearTimeout(fallback)
	}, [])

	useEffect(() => {
		let reconnectTimer: ReturnType<typeof setTimeout>

		function connect() {
			const es = new EventSource(
				recalboxId ? `/api/events?recalboxId=${encodeURIComponent(recalboxId)}` : '/api/events',
			)
			esRef.current = es

			es.onmessage = (e: MessageEvent<string>) => {
				let event: SSEEvent
				try {
					event = JSON.parse(e.data) as SSEEvent
				} catch {
					return
				}

				// Only box-scoped events carry a recalboxId; notifications and feedback
				// are cross-box and go straight to subscribers.
				const box = (event as { recalboxId?: string }).recalboxId
				if (box !== undefined) {
					setStream((prev) =>
						// First event from a different box: start from a clean slate instead of
						// inheriting the previous box's game/stats.
						applyEvent(prev.box === box ? prev : { ...initialStream, box }, event),
					)
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
	}, [recalboxId])

	const subscribe = useCallback((handler: Handler) => {
		handlersRef.current?.add(handler)
		return () => {
			handlersRef.current?.delete(handler)
		}
	}, [])

	// Derive rather than reset: state describing a box other than the active one is
	// stale by construction — during the switch, and for any straggler from the old
	// stream. `box === null` is the pre-first-event / unfiltered case, which is fine
	// to read (it holds the 10s offline fallback).
	const stale = recalboxId !== null && stream.box !== null && stream.box !== recalboxId
	const activity = stale ? initialActivity : stream.activity
	const mqttOnline = stale ? null : stream.mqttOnline

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
