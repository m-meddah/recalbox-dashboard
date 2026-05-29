'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { AvailableTime, Mood, ScoredGame } from '@/lib/recommendations/types'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { RecommendationCard } from './recommendation-card'

export function PlayTonightResults({
	time,
	mood,
	requestId,
	debugMode = false,
	onReshuffle,
}: {
	time: AvailableTime
	mood: Mood
	requestId: number
	debugMode?: boolean
	onReshuffle: () => void
}) {
	const t = useTranslations('playTonight.results')
	const [recs, setRecs] = useState<ScoredGame[]>([])
	const [loading, setLoading] = useState(false)

	// biome-ignore lint/correctness/useExhaustiveDependencies: requestId is an intentional refetch trigger
	useEffect(() => {
		setLoading(true)
		fetch('/api/play-tonight/recommend', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ availableMinutes: time, mood }),
		})
			.then((r) => r.json())
			.then((d) => {
				setRecs(d.recommendations ?? [])
				setLoading(false)
			})
	}, [time, mood, requestId])

	async function handleSkip(gameId: number) {
		await fetch('/api/play-tonight/skip', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ gameId }),
		})
		setRecs((r) => r.filter((x) => x.gameId !== gameId))
	}

	async function handleLaunch(gameId: number) {
		await fetch('/api/play-tonight/launch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ gameId }),
		})
	}

	if (loading)
		return (
			<Card>
				<CardContent className="py-12 flex items-center justify-center gap-3 text-muted-foreground">
					<Loader2 className="w-5 h-5 animate-spin" /> {t('loading')}
				</CardContent>
			</Card>
		)

	if (recs.length === 0)
		return (
			<Card>
				<CardContent className="py-12 text-center space-y-3">
					<p className="text-muted-foreground">{t('empty')}</p>
					<p className="text-sm text-muted-foreground">{t('emptyHint')}</p>
				</CardContent>
			</Card>
		)

	return (
		<div className="space-y-4">
			<div className="grid gap-4 md:grid-cols-3">
				{recs.map((r) => (
					<RecommendationCard
						key={r.gameId}
						game={r}
						debugMode={debugMode}
						onSkip={() => handleSkip(r.gameId)}
						onLaunch={() => handleLaunch(r.gameId)}
					/>
				))}
			</div>
			<div className="flex justify-center">
				<Button variant="outline" onClick={onReshuffle}>
					<RefreshCw className="w-4 h-4 mr-2" /> {t('reshuffle')}
				</Button>
			</div>
		</div>
	)
}
