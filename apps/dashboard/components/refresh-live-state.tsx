'use client'

import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

/**
 * Serverless replacement for the SSE stream: the live state is rendered server-side
 * once, and the user decides when to pay for another read. router.refresh() re-runs
 * the RSC layout, which rebuilds the seed and re-renders the provider.
 */
export function RefreshLiveState({ lastSeenAt }: { lastSeenAt: Date | null }) {
	const t = useTranslations('dashboard.live')
	const format = useFormatter()
	const router = useRouter()
	const [pending, startTransition] = useTransition()

	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground">
			<span>
				{lastSeenAt ? t('lastSignal', { time: format.relativeTime(lastSeenAt) }) : t('never')}
			</span>
			<Button
				variant="ghost"
				size="sm"
				disabled={pending}
				onClick={() => startTransition(() => router.refresh())}
			>
				<RefreshCw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} />
				{t('refresh')}
			</Button>
		</div>
	)
}
