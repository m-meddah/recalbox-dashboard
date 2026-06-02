'use client'

import { type FeedbackItem, FeedbackToast } from '@/components/feedback/feedback-toast'
import { Card, CardContent } from '@/components/ui/card'
import { Inbox } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

export default function FeedbackInboxPage() {
	const [pending, setPending] = useState<FeedbackItem[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		fetch('/api/feedback/pending')
			.then((r) => r.json())
			.then((d) => {
				setPending(d.pending)
				setLoading(false)
			})
			.catch(() => setLoading(false))
	}, [])

	const handleRespond = useCallback(async (feedbackId: number, response: string) => {
		await fetch('/api/feedback/respond', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ feedbackId, response }),
		})
		setPending((p) => p.filter((f) => f.id !== feedbackId))
	}, [])

	return (
		<div className="container mx-auto max-w-2xl px-4 py-8 space-y-4">
			<header className="space-y-1">
				<h1 className="text-2xl font-bold flex items-center gap-2">
					<Inbox className="size-6" />
					Feedback en attente
				</h1>
				<p className="text-muted-foreground">Tes sessions récentes attendent ton verdict.</p>
			</header>

			{loading ? (
				<Card>
					<CardContent className="py-12 text-center text-muted-foreground">Chargement…</CardContent>
				</Card>
			) : pending.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center text-muted-foreground">
						Aucun feedback en attente.
					</CardContent>
				</Card>
			) : (
				<div className="space-y-3">
					{pending.map((f) => (
						<FeedbackToast
							key={f.id}
							feedback={f}
							variant="inline"
							onRespond={(response) => handleRespond(f.id, response)}
							onDismiss={() => {}}
						/>
					))}
				</div>
			)}
		</div>
	)
}
