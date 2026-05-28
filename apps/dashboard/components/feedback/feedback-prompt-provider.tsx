'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { useCallback, useEffect, useState } from 'react'
import { type FeedbackItem, FeedbackToast } from './feedback-toast'

/**
 * Global provider that:
 * - Fetches pending feedback on mount
 * - Listens for 'feedback:new' SSE events to refresh the list
 * - Shows a floating toast for the most recent unanswered, undismissed entry
 * - Handles respond and dismiss actions
 *
 * Must be mounted inside RecalboxEventsProvider.
 */
export function FeedbackPromptProvider({ children }: { children: React.ReactNode }) {
	const [pending, setPending] = useState<FeedbackItem[]>([])
	const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set())
	const { subscribe } = useRecalboxEvents()

	const fetchPending = useCallback(async () => {
		try {
			const res = await fetch('/api/feedback/pending')
			if (!res.ok) return
			const data = await res.json()
			setPending(data.pending)
		} catch {
			// silently fail — feedback is non-critical
		}
	}, [])

	useEffect(() => {
		fetchPending()

		return subscribe((event) => {
			if (event.type === 'feedback:new') {
				fetchPending()
			}
		})
	}, [fetchPending, subscribe])

	const handleRespond = useCallback(async (feedbackId: number, response: string) => {
		try {
			await fetch('/api/feedback/respond', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ feedbackId, response }),
			})
			setPending((p) => p.filter((f) => f.id !== feedbackId))
		} catch {
			// silently fail
		}
	}, [])

	const handleDismiss = useCallback(async (feedbackId: number) => {
		setDismissedIds((d) => {
			const next = new Set(d)
			next.add(feedbackId)
			return next
		})
		try {
			await fetch('/api/feedback/dismiss', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ feedbackId }),
			})
		} catch {
			// silently fail
		}
	}, [])

	// Show the most recent pending that hasn't been dismissed in this session
	// and hasn't been shown before (shownAt is null)
	const visible = pending.find((f) => !dismissedIds.has(f.id) && !f.shownAt)

	return (
		<>
			{children}
			{visible && (
				<FeedbackToast
					feedback={visible}
					variant="floating"
					onRespond={(response) => handleRespond(visible.id, response)}
					onDismiss={() => handleDismiss(visible.id)}
				/>
			)}
		</>
	)
}
