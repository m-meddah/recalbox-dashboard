'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { Loader2, RotateCw } from 'lucide-react'

type WeightedItem = { key: string; weight: number; rawScore: number }
type GameInfo = { id: number; name: string; system: string; imagePath: string | null }

type ProfileData = {
	systemsWeights: WeightedItem[]
	genresWeights: WeightedItem[]
	decadesWeights: WeightedItem[]
	developersWeights: WeightedItem[]
	comfortGames: GameInfo[]
	bouncerGames: GameInfo[]
	totalSignalSessions: number
	profileMaturity: number
	computedAt: string | null
}

export default function ProfilePage() {
	const [profile, setProfile] = useState<ProfileData | null>(null)
	const [recomputing, setRecomputing] = useState(false)

	useEffect(() => {
		refresh()
	}, [])

	async function refresh() {
		const res = await fetch('/api/profile')
		setProfile(await res.json())
	}

	async function handleRecompute() {
		setRecomputing(true)
		await fetch('/api/profile/recompute', { method: 'POST' })
		await refresh()
		setRecomputing(false)
	}

	if (!profile) {
		return <div className="container py-8 text-muted-foreground">Chargement…</div>
	}

	const maturityPercent = Math.round(profile.profileMaturity * 100)
	const lastUpdate = profile.computedAt
		? new Date(profile.computedAt).toLocaleString('fr-FR', {
				dateStyle: 'short',
				timeStyle: 'short',
			})
		: 'jamais'

	return (
		<div className="container max-w-4xl py-8 space-y-6">
			<header className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<h1 className="text-2xl font-bold">Ton profil de joueur</h1>
					<p className="text-muted-foreground text-sm">
						Inféré automatiquement depuis tes sessions. Mis à jour le {lastUpdate}.
					</p>
				</div>
				<Button variant="outline" size="sm" onClick={handleRecompute} disabled={recomputing}>
					{recomputing ? (
						<Loader2 className="w-4 h-4 mr-2 animate-spin" />
					) : (
						<RotateCw className="w-4 h-4 mr-2" />
					)}
					Recalculer
				</Button>
			</header>

			<Card>
				<CardContent className="py-4 space-y-2">
					<Progress value={maturityPercent}>
						<ProgressLabel>Maturité du profil</ProgressLabel>
						<ProgressValue />
					</Progress>
					<p className="text-xs text-muted-foreground">
						{profile.totalSignalSessions} session
						{profile.totalSignalSessions > 1 ? 's' : ''} significative
						{profile.totalSignalSessions > 1 ? 's' : ''} —{' '}
						{maturityPercent < 30
							? 'Profil jeune : joue plus pour améliorer les recommandations.'
							: maturityPercent < 70
								? 'Profil en construction : les recos se précisent.'
								: 'Profil mature : recommandations bien calibrées.'}
					</p>
				</CardContent>
			</Card>

			<div className="grid md:grid-cols-2 gap-4">
				<WeightedSection title="Systèmes préférés" items={profile.systemsWeights} />
				<WeightedSection title="Genres préférés" items={profile.genresWeights} />
				<WeightedSection title="Décennies préférées" items={profile.decadesWeights} />
				<WeightedSection title="Développeurs préférés" items={profile.developersWeights} />
			</div>

			<GameList
				title="Tes comfort games"
				description="Les jeux où tu reviens le plus souvent et joues le plus longtemps"
				games={profile.comfortGames}
			/>

			<GameList
				title="Tes 'bouncers'"
				description="Les jeux que tu lances mais quittes vite — l'algo évitera de te les proposer"
				games={profile.bouncerGames}
				muted
			/>
		</div>
	)
}

function WeightedSection({ title, items }: { title: string; items: WeightedItem[] }) {
	if (items.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">{title}</CardTitle>
				</CardHeader>
				<CardContent className="text-sm text-muted-foreground">
					Pas encore assez de données.
				</CardContent>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">{title}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				{items.slice(0, 8).map((item) => (
					<div key={item.key} className="space-y-1">
						<div className="flex justify-between text-sm">
							<span className="font-medium truncate">{item.key}</span>
							<span className="text-muted-foreground text-xs ml-2 shrink-0">
								{Math.round(item.weight * 100)}%
							</span>
						</div>
						<div className="h-1.5 bg-muted rounded-full overflow-hidden">
							<div
								className="h-full bg-primary transition-all"
								style={{ width: `${item.weight * 100}%` }}
							/>
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	)
}

function GameList({
	title,
	description,
	games,
	muted = false,
}: {
	title: string
	description: string
	games: GameInfo[]
	muted?: boolean
}) {
	if (games.length === 0) return null

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">{title}</CardTitle>
				<p className="text-sm text-muted-foreground">{description}</p>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
					{games.map((g) => (
						<div key={g.id} className={`space-y-1 ${muted ? 'opacity-60' : ''}`}>
							{g.imagePath ? (
								<img
									src={`/api/media?path=${encodeURIComponent(g.imagePath)}`}
									alt={g.name}
									className="w-full aspect-video object-contain bg-muted rounded"
								/>
							) : (
								<div className="w-full aspect-video bg-muted rounded" />
							)}
							<p className="text-xs font-medium truncate">{g.name}</p>
							<p className="text-xs text-muted-foreground">{g.system}</p>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	)
}
