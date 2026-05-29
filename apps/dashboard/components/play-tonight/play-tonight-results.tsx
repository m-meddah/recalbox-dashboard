'use client'

import { useEffect, useState } from 'react'
import { RecommendationCard } from './recommendation-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RefreshCw, Loader2 } from 'lucide-react'
import type { ScoredGame, Mood, AvailableTime } from '@/lib/recommendations/types'

export function PlayTonightResults({
	time,
	mood,
	requestId,
	onReshuffle,
}: {
	time: AvailableTime
	mood: Mood
	requestId: number
	onReshuffle: () => void
}) {
	const [recs, setRecs] = useState<ScoredGame[]>([])
	const [loading, setLoading] = useState(false)

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
					<Loader2 className="w-5 h-5 animate-spin" /> Recherche en cours…
				</CardContent>
			</Card>
		)

	if (recs.length === 0)
		return (
			<Card>
				<CardContent className="py-12 text-center space-y-3">
					<p className="text-muted-foreground">Aucun jeu ne correspond à ces critères.</p>
					<p className="text-sm text-muted-foreground">
						Essaye un autre temps/humeur, ou joue plus pour enrichir ton profil.
					</p>
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
						onSkip={() => handleSkip(r.gameId)}
						onLaunch={() => handleLaunch(r.gameId)}
					/>
				))}
			</div>
			<div className="flex justify-center">
				<Button variant="outline" onClick={onReshuffle}>
					<RefreshCw className="w-4 h-4 mr-2" /> Proposer d'autres jeux
				</Button>
			</div>
		</div>
	)
}
