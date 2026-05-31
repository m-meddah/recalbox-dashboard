'use client'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronRight, Inbox } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

export function FeedbackInboxNudge() {
	const [count, setCount] = useState<number | null>(null)

	useEffect(() => {
		fetch('/api/feedback/pending')
			.then((r) => (r.ok ? r.json() : { pending: [] }))
			.then((d) => setCount(d.pending.length))
			.catch(() => setCount(0))
	}, [])

	if (count === null || count === 0) return null

	return (
		<Card className="border-orange-500/30 bg-orange-500/5">
			<CardContent className="py-3 flex items-center justify-between gap-3">
				<div className="flex items-center gap-3 min-w-0">
					<Inbox className="size-5 text-orange-600 dark:text-orange-400 shrink-0" />
					<p className="text-sm">
						<span className="font-medium">{count}</span> session{count > 1 ? 's' : ''} attend
						{count === 1 ? '' : 'ent'} ton avis
					</p>
				</div>
				<Link href="/feedback" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
					Répondre
					<ChevronRight className="size-4 ml-1" />
				</Link>
			</CardContent>
		</Card>
	)
}
