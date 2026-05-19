'use client'

import { SuperRetrogamersLink } from '@/components/super-retrogamers-link'
import { formatDuration } from '@/lib/stats/formatters'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type GameEntry = {
	romPath: string
	gameName: string
	system: string
	playtimeSec: number
	sessionCount: number
	srHasPage?: number | null
	srUrl?: string | null
}

type Props = {
	games: GameEntry[]
}

export function TopGames({ games }: Props) {
	const t = useTranslations('stats.topGames')
	const [showAll, setShowAll] = useState(false)

	if (games.length === 0) {
		return <p className="py-4 text-center text-sm text-muted-foreground">{t('empty')}</p>
	}

	const maxPlaytime = games[0]?.playtimeSec ?? 1
	const visible = showAll ? games.slice(0, 50) : games.slice(0, 10)

	return (
		<div className="space-y-1">
			{visible.map((game, i) => (
				<div
					key={game.romPath}
					className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50"
				>
					<span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
						{i + 1}
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex items-baseline justify-between gap-2">
							<p className="truncate text-sm font-medium">{game.gameName}</p>
							<span className="shrink-0 text-xs font-mono text-muted-foreground">
								{formatDuration(game.playtimeSec)}
							</span>
						</div>
						<div className="mt-1 flex items-center gap-2">
							<div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
								<div
									className="h-full rounded-full bg-emerald-500/70"
									style={{ width: `${Math.round((game.playtimeSec / maxPlaytime) * 100)}%` }}
								/>
							</div>
							<span className="shrink-0 text-[10px] text-muted-foreground capitalize">
								{game.system}
							</span>
							{game.srHasPage === 1 && (
								<SuperRetrogamersLink
									srHasPage={game.srHasPage}
									srUrl={game.srUrl ?? null}
									variant="icon"
								/>
							)}
						</div>
					</div>
				</div>
			))}

			{games.length > 10 && (
				<button
					type="button"
					onClick={() => setShowAll((v) => !v)}
					className="mt-2 w-full rounded-lg py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				>
					{showAll ? t('showLess') : t('showMore', { count: Math.min(50, games.length) - 10 })}
				</button>
			)}
		</div>
	)
}
