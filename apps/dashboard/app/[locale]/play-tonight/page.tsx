'use client'

import { PlayTonightControls } from '@/components/play-tonight/play-tonight-controls'
import { PlayTonightResults } from '@/components/play-tonight/play-tonight-results'
import { ProfileMaturityBanner } from '@/components/play-tonight/profile-maturity-banner'
import type { AvailableTime, Mood } from '@/lib/recommendations/types'
import { HelpCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

export default function PlayTonightPage() {
	const t = useTranslations('playTonight')
	const [time, setTime] = useState<AvailableTime>(60)
	const [mood, setMood] = useState<Mood>('surprise')
	const [submitted, setSubmitted] = useState(false)
	const [requestId, setRequestId] = useState(0)
	const [debugMode, setDebugMode] = useState(false)

	return (
		<div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
			<header className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<h1 className="text-2xl sm:text-3xl font-bold">{t('title')}</h1>
					<p className="text-muted-foreground">{t('subtitle')}</p>
				</div>
				<div className="flex flex-col items-end gap-2 shrink-0">
					<Link
						href="/play-tonight/about"
						className="text-xs text-primary inline-flex items-center hover:underline"
					>
						<HelpCircle className="w-3.5 h-3.5 mr-1" /> {t('howItWorks')}
					</Link>
					<label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
						<input
							type="checkbox"
							checked={debugMode}
							onChange={(e) => setDebugMode(e.target.checked)}
							className="w-3 h-3"
						/>
						{t('debug')}
					</label>
				</div>
			</header>

			<ProfileMaturityBanner />

			<PlayTonightControls
				time={time}
				mood={mood}
				onTimeChange={setTime}
				onMoodChange={setMood}
				onSubmit={() => {
					setSubmitted(true)
					setRequestId((id) => id + 1)
				}}
			/>

			{submitted && (
				<PlayTonightResults
					time={time}
					mood={mood}
					requestId={requestId}
					debugMode={debugMode}
					onReshuffle={() => setRequestId((id) => id + 1)}
				/>
			)}
		</div>
	)
}
