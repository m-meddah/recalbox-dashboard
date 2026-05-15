'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'
import { Gamepad2, WifiOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

function useElapsedTime(startedAt: Date | null): string {
	const [elapsed, setElapsed] = useState('')

	useEffect(() => {
		if (!startedAt) {
			setElapsed('')
			return
		}
		const update = () => {
			const secs = Math.floor((Date.now() - startedAt.getTime()) / 1000)
			const h = Math.floor(secs / 3600)
			const m = Math.floor((secs % 3600) / 60)
			const s = secs % 60
			setElapsed(
				h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`,
			)
		}
		update()
		const id = setInterval(update, 1000)
		return () => clearInterval(id)
	}, [startedAt])

	return elapsed
}

function LiveBadge() {
	return (
		<span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-500">
			<span className="relative flex size-2">
				<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
				<span className="relative inline-flex rounded-full size-2 bg-green-500" />
			</span>
			LIVE
		</span>
	)
}

function GameCard({ game }: { game: GameStartEvent }) {
	const elapsed = useElapsedTime(game.startedAt)
	const imageUrl = game.imagePath ? `/api/media?path=${encodeURIComponent(game.imagePath)}` : null

	return (
		<Card className="overflow-hidden">
			<CardContent className="p-0">
				<div className="flex gap-4 p-4">
					<div className="shrink-0 w-24 h-24 rounded-md overflow-hidden bg-muted flex items-center justify-center">
						{imageUrl ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={imageUrl}
								alt={game.gameName}
								className="w-full h-full object-cover"
								onError={(e) => {
									e.currentTarget.style.display = 'none'
								}}
							/>
						) : (
							<Gamepad2 className="size-10 text-muted-foreground" />
						)}
					</div>
					<div className="flex flex-col justify-between min-w-0">
						<div className="space-y-1">
							<LiveBadge />
							<p className="font-semibold leading-tight truncate">{game.gameName}</p>
							<div className="flex items-center gap-2 flex-wrap">
								<Badge variant="secondary" className="text-xs">
									{game.systemFullName}
								</Badge>
								{game.emulator && (
									<span className="text-xs text-muted-foreground">{game.emulator}</span>
								)}
							</div>
						</div>
						<p className="text-sm text-muted-foreground tabular-nums">{elapsed}</p>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function EmptyState() {
	const t = useTranslations('nowPlaying')
	return (
		<Card className="border-dashed">
			<CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
				<Gamepad2 className="size-12 text-muted-foreground opacity-40" />
				<p className="text-muted-foreground text-sm">{t('noGame')}</p>
			</CardContent>
		</Card>
	)
}

function LoadingSkeleton() {
	return (
		<Card>
			<CardContent className="p-4">
				<div className="flex gap-4">
					<Skeleton className="w-24 h-24 rounded-md shrink-0" />
					<div className="flex flex-col gap-2 flex-1 justify-center">
						<Skeleton className="h-3 w-12" />
						<Skeleton className="h-5 w-3/4" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-3 w-16" />
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

export function NowPlaying() {
	const t = useTranslations('nowPlaying')
	const { mqttOnline, subscribe } = useRecalboxEvents()
	const [currentGame, setCurrentGame] = useState<GameStartEvent | null>(null)

	const handleEvent = useCallback((event: { type: string } & Record<string, unknown>) => {
		if (event.type === 'game:start') {
			const e = event as unknown as GameStartEvent
			setCurrentGame({ ...e, startedAt: new Date(e.startedAt) })
		} else if (event.type === 'game:stop') {
			const e = event as unknown as GameStopEvent
			setCurrentGame((prev) => (prev?.romPath === e.romPath ? null : prev))
		}
	}, [])

	useEffect(() => {
		return subscribe(handleEvent)
	}, [subscribe, handleEvent])

	return (
		<div className="space-y-3">
			{mqttOnline === false && (
				<div className="flex items-center gap-2 text-xs text-orange-500 font-medium">
					<WifiOff className="size-3.5" />
					<span>{t('mqttOffline')}</span>
				</div>
			)}
			{mqttOnline === null ? (
				<LoadingSkeleton />
			) : currentGame ? (
				<GameCard game={currentGame} />
			) : (
				<EmptyState />
			)}
		</div>
	)
}
