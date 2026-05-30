'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ScoredGame } from '@/lib/recommendations/types'
import { cn } from '@/lib/utils'
import { translateGenre } from '@/lib/genres/genre-map'
import { HelpCircle, Play, Sparkles, Target, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

const CONF_STYLE = {
	high: { icon: Target, cls: 'text-green-600 dark:text-green-400', bg: 'bg-green-500/10' },
	medium: { icon: HelpCircle, cls: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10' },
	exploration: {
		icon: Sparkles,
		cls: 'text-purple-600 dark:text-purple-400',
		bg: 'bg-purple-500/10',
	},
} as const

export function RecommendationCard({
	game,
	debugMode = false,
	onSkip,
	onLaunch,
}: {
	game: ScoredGame
	debugMode?: boolean
	onSkip: () => void
	onLaunch: () => void
}) {
	const t = useTranslations('playTonight.card')
	const locale = useLocale()
	const tg = (genre: string) => translateGenre(genre, locale)
	const conf = CONF_STYLE[game.confidence]
	const ConfIcon = conf.icon

	return (
		<Card className="overflow-hidden flex flex-col h-full">
			<div className="relative aspect-video bg-muted overflow-hidden">
				{game.videoUrl ? (
					<video
						autoPlay
						muted
						loop
						playsInline
						className="w-full h-full object-cover"
						src={`/api/media?path=${encodeURIComponent(game.videoUrl)}`}
					/>
				) : game.imageUrl ? (
					<img
						src={`/api/media?path=${encodeURIComponent(game.imageUrl)}`}
						alt={game.name}
						className="w-full h-full object-contain"
					/>
				) : null}
				<div
					className={cn(
						'absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium backdrop-blur-sm',
						conf.bg,
						conf.cls,
					)}
				>
					<ConfIcon className="w-3 h-3" /> {t(`confidence.${game.confidence}`)}
				</div>
				{game.igdbBoosted && (
					<div className="absolute top-2 right-2 px-2 py-1 rounded-md text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 backdrop-blur-sm">
						IGDB
					</div>
				)}
			</div>
			<CardContent className="p-4 flex flex-col flex-1 gap-3">
				<div className="space-y-2">
					<h3 className="font-bold text-lg leading-tight">{game.name}</h3>
					<div className="flex flex-wrap gap-1">
						<Badge variant="secondary" className="text-xs">
							{game.system}
						</Badge>
						{game.genres.slice(0, 2).map((g) => (
							<Badge key={g} variant="outline" className="text-xs">
								{tg(g)}
							</Badge>
						))}
					</div>
				</div>
				{game.reasons.length > 0 && (
					<ul className="space-y-1 text-sm text-muted-foreground">
						{game.reasons.map((r) => (
							<li key={r.key} className="flex items-start gap-1">
								<span className="text-primary mt-0.5">•</span>
								<span>{t(`reasons.${r.key}` as any, ('params' in r
									? r.key === 'favoriteGenre' ? { genre: tg(r.params.genre) } : r.params
									: {}) as any)}</span>
							</li>
						))}
					</ul>
				)}
				<div className="mt-auto pt-3 flex gap-2">
					<Button onClick={onLaunch} className="flex-1">
						<Play className="w-4 h-4 mr-1" /> {t('launch')}
					</Button>
					<Button variant="outline" size="icon" onClick={onSkip} title={t('skip')}>
						<X className="w-4 h-4" />
					</Button>
				</div>
				{debugMode && game.scoreBreakdown && (
					<details className="mt-2 text-xs">
						<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
							Score : {game.score.toFixed(1)} ({game.confidence})
						</summary>
						<div className="mt-2 space-y-0.5 pl-2 border-l">
							{Object.entries(game.scoreBreakdown)
								.sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
								.map(([key, value]) => (
									<div key={key} className="flex justify-between font-mono">
										<span className="text-muted-foreground">{key}</span>
										<span
											className={
												value > 0
													? 'text-green-600 dark:text-green-400'
													: value < 0
														? 'text-red-600 dark:text-red-400'
														: ''
											}
										>
											{value > 0 ? '+' : ''}
											{value.toFixed(1)}
										</span>
									</div>
								))}
						</div>
					</details>
				)}
			</CardContent>
		</Card>
	)
}
