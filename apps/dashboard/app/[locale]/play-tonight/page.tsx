'use client'

import { useState } from 'react'
import { PlayTonightControls } from '@/components/play-tonight/play-tonight-controls'
import { PlayTonightResults } from '@/components/play-tonight/play-tonight-results'
import { ProfileMaturityBanner } from '@/components/play-tonight/profile-maturity-banner'
import type { Mood, AvailableTime } from '@/lib/recommendations/types'

export default function PlayTonightPage() {
	const [time, setTime] = useState<AvailableTime>(60)
	const [mood, setMood] = useState<Mood>('surprise')
	const [submitted, setSubmitted] = useState(false)
	const [requestId, setRequestId] = useState(0)

	return (
		<div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
			<header className="space-y-1">
				<h1 className="text-2xl sm:text-3xl font-bold">Que jouer ce soir ?</h1>
				<p className="text-muted-foreground">
					Choisis ton humeur et le temps que tu as, je m'occupe du reste.
				</p>
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
					onReshuffle={() => setRequestId((id) => id + 1)}
				/>
			)}
		</div>
	)
}
