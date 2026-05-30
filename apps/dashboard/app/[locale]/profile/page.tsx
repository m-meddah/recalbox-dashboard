'use client'

import { RecommendationQuality } from '@/components/profile/recommendation-quality'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { Loader2, RotateCw } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

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
	const t = useTranslations('profile')
	const locale = useLocale()
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
		return <div className="container py-8 text-muted-foreground">{t('loading')}</div>
	}

	const maturityPercent = Math.round(profile.profileMaturity * 100)
	const lastUpdate = profile.computedAt
		? new Date(profile.computedAt).toLocaleString(locale, {
				dateStyle: 'short',
				timeStyle: 'short',
			})
		: t('lastUpdateNever')

	return (
		<div className="container mx-auto max-w-4xl px-4 py-8 space-y-6">
			<header className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<h1 className="text-2xl font-bold">{t('title')}</h1>
					<p className="text-muted-foreground text-sm">{t('subtitle', { date: lastUpdate })}</p>
				</div>
				<Button variant="outline" size="sm" onClick={handleRecompute} disabled={recomputing}>
					{recomputing ? (
						<Loader2 className="w-4 h-4 mr-2 animate-spin" />
					) : (
						<RotateCw className="w-4 h-4 mr-2" />
					)}
					{t('recompute')}
				</Button>
			</header>

			<Card>
				<CardContent className="py-4 space-y-2">
					<Progress value={maturityPercent}>
						<ProgressLabel>{t('maturityLabel')}</ProgressLabel>
						<ProgressValue />
					</Progress>
					<p className="text-xs text-muted-foreground">
						{t('sessions', { count: profile.totalSignalSessions })} —{' '}
						{maturityPercent < 30
							? t('maturityYoung')
							: maturityPercent < 70
								? t('maturityBuilding')
								: t('maturityMature')}
					</p>
				</CardContent>
			</Card>

			<div className="grid md:grid-cols-2 gap-4">
				<WeightedSection
					title={t('systemsTitle')}
					items={profile.systemsWeights}
					noDataText={t('noData')}
				/>
				<WeightedSection
					title={t('genresTitle')}
					items={profile.genresWeights}
					noDataText={t('noData')}
				/>
				<WeightedSection
					title={t('decadesTitle')}
					items={profile.decadesWeights}
					noDataText={t('noData')}
				/>
				<WeightedSection
					title={t('developersTitle')}
					items={profile.developersWeights}
					noDataText={t('noData')}
				/>
			</div>

			<GameList
				title={t('comfortGamesTitle')}
				description={t('comfortGamesDesc')}
				games={profile.comfortGames}
			/>

			<GameList
				title={t('bouncersTitle')}
				description={t('bouncersDesc')}
				games={profile.bouncerGames}
				muted
			/>

			<RecommendationQuality />
		</div>
	)
}

function WeightedSection({
	title,
	items,
	noDataText,
}: { title: string; items: WeightedItem[]; noDataText: string }) {
	if (items.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">{title}</CardTitle>
				</CardHeader>
				<CardContent className="text-sm text-muted-foreground">{noDataText}</CardContent>
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
