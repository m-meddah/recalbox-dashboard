'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { SuperRetrogamersLink } from '@/components/super-retrogamers-link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { GameStartEvent, GameStopEvent, SystemChangeEvent } from '@/lib/recalbox/events'
import { Gamepad2, Monitor, Moon, WifiOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'

function useElapsedTime(startedAt: Date | null): string {
	const [elapsed, setElapsed] = useState('')

	useEffect(() => {
		if (!startedAt) return
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

	return startedAt ? elapsed : ''
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

function DemoBadge() {
	return (
		<span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400">
			<Moon className="size-3" />
			DEMO
		</span>
	)
}

function BrowsingBadge() {
	return (
		<span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-500">
			<span className="relative flex size-2">
				<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
				<span className="relative inline-flex rounded-full size-2 bg-blue-500" />
			</span>
			BROWSING
		</span>
	)
}

function GameCard({ game }: { game: GameStartEvent }) {
	const elapsed = useElapsedTime(game.startedAt)
	const imageUrl = game.imagePath ? `/api/media?path=${encodeURIComponent(game.imagePath)}` : null
	const [srInfo, setSrInfo] = useState<{ srHasPage: number | null; srUrl: string | null }>({
		srHasPage: null,
		srUrl: null,
	})

	useEffect(() => {
		fetch(`/api/super-retrogamers/game-info?romPath=${encodeURIComponent(game.romPath)}`)
			.then((r) => r.json())
			.then((data: { srHasPage: number | null; srUrl: string | null }) => setSrInfo(data))
			.catch(() => {})
	}, [game.romPath])

	return (
		<Card className="overflow-hidden">
			<CardContent className="p-0">
				<div className="flex gap-4 p-4">
					<div className="shrink-0 size-24 rounded-md overflow-hidden bg-muted flex items-center justify-center">
						{imageUrl ? (
							<Image
								src={imageUrl}
								alt={game.gameName}
								width={96}
								height={96}
								className="w-full h-full object-cover"
								unoptimized
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
							{game.fromScreensaver ? <DemoBadge /> : <LiveBadge />}
							<p className="font-semibold leading-tight truncate">{game.gameName}</p>
							<div className="flex items-center gap-2 flex-wrap">
								<Badge variant="secondary" className="text-xs">
									{game.systemFullName}
								</Badge>
								{game.emulator && (
									<span className="text-xs text-muted-foreground">{game.emulator}</span>
								)}
								{srInfo.srHasPage === 1 && (
									<SuperRetrogamersLink
										srHasPage={srInfo.srHasPage}
										srUrl={srInfo.srUrl}
										variant="icon"
									/>
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

function BrowsingCard({ browsing }: { browsing: SystemChangeEvent }) {
	const t = useTranslations('nowPlaying')
	const imageUrl = browsing.imagePath
		? `/api/media?path=${encodeURIComponent(browsing.imagePath)}`
		: null

	return (
		<Card className="overflow-hidden border-blue-500/20">
			<CardContent className="p-0">
				<div className="flex gap-4 p-4">
					<div className="shrink-0 size-24 rounded-md overflow-hidden bg-muted flex items-center justify-center">
						{imageUrl ? (
							<Image
								src={imageUrl}
								alt={browsing.gameName ?? browsing.systemFullName}
								width={96}
								height={96}
								className="w-full h-full object-cover"
								unoptimized
								onError={(e) => {
									e.currentTarget.style.display = 'none'
								}}
							/>
						) : (
							<Monitor className="size-10 text-muted-foreground" />
						)}
					</div>
					<div className="flex flex-col justify-between min-w-0">
						<div className="space-y-1">
							<BrowsingBadge />
							{browsing.gameName ? (
								<p className="font-semibold leading-tight truncate">{browsing.gameName}</p>
							) : (
								<p className="font-semibold leading-tight truncate text-muted-foreground">
									{t('browsingSystem')}
								</p>
							)}
							<Badge variant="outline" className="text-xs">
								{browsing.systemFullName}
							</Badge>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function ScreensaverCard() {
	const t = useTranslations('nowPlaying')
	return (
		<Card className="border-dashed border-indigo-500/30">
			<CardContent className="flex flex-col items-center justify-center py-10 text-center gap-3">
				<Moon className="size-10 text-indigo-400 opacity-70" />
				<p className="text-muted-foreground text-sm">{t('screensaver')}</p>
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
					<Skeleton className="size-24 rounded-md shrink-0" />
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
	const [browsing, setBrowsing] = useState<SystemChangeEvent | null>(null)
	const [screensaver, setScreensaver] = useState(false)

	const handleEvent = useCallback((event: { type: string } & Record<string, unknown>) => {
		if (event.type === 'game:start') {
			const e = event as unknown as GameStartEvent
			setCurrentGame({ ...e, startedAt: new Date(e.startedAt) })
			setScreensaver(false)
		} else if (event.type === 'game:stop') {
			const e = event as unknown as GameStopEvent
			setCurrentGame((prev) => (prev?.romPath === e.romPath ? null : prev))
		} else if (event.type === 'system:change') {
			const e = event as unknown as SystemChangeEvent
			setBrowsing(e)
			setScreensaver(false)
			// Leaving the screensaver into the menus — drop any demo clip still showing.
			setCurrentGame((prev) => (prev?.fromScreensaver ? null : prev))
		} else if (event.type === 'screensaver:start') {
			setScreensaver(true)
		} else if (event.type === 'screensaver:stop') {
			setScreensaver(false)
			setCurrentGame((prev) => (prev?.fromScreensaver ? null : prev))
		}
	}, [])

	useEffect(() => {
		return subscribe(handleEvent)
	}, [subscribe, handleEvent])

	const content = () => {
		if (mqttOnline === null) return <LoadingSkeleton />
		if (currentGame) return <GameCard game={currentGame} />
		if (screensaver) return <ScreensaverCard />
		if (browsing) return <BrowsingCard browsing={browsing} />
		return <EmptyState />
	}

	return (
		<div className="space-y-3">
			{mqttOnline === false && (
				<div className="flex items-center gap-2 text-xs text-orange-500 font-medium">
					<WifiOff className="size-3.5" />
					<span>{t('mqttOffline')}</span>
				</div>
			)}
			{content()}
		</div>
	)
}
