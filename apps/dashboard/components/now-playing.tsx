'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { SuperRetrogamersLink } from '@/components/super-retrogamers-link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { GameMedia } from '@/lib/db/queries'
import type { GameStartEvent, GameStopEvent, SystemChangeEvent } from '@/lib/recalbox/events'
import { systemEmoji } from '@/lib/recalbox/system-meta'
import { getSystemSpecs } from '@/lib/recalbox/system-specs'
import { cn } from '@/lib/utils'
import { Gamepad2, Moon, Star, WifiOff } from 'lucide-react'
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

function mediaUrl(path: string | null | undefined): string | null {
	return path ? `/api/media?path=${encodeURIComponent(path)}` : null
}

function GameCard({ game }: { game: GameStartEvent }) {
	const elapsed = useElapsedTime(game.startedAt)
	const [srInfo, setSrInfo] = useState<{ srHasPage: number | null; srUrl: string | null }>({
		srHasPage: null,
		srUrl: null,
	})
	const [media, setMedia] = useState<GameMedia | null>(null)
	const [boxFailed, setBoxFailed] = useState(false)
	const [shotFailed, setShotFailed] = useState(false)

	useEffect(() => {
		setMedia(null)
		setBoxFailed(false)
		setShotFailed(false)
		fetch(`/api/super-retrogamers/game-info?romPath=${encodeURIComponent(game.romPath)}`)
			.then((r) => r.json())
			.then((data: { srHasPage: number | null; srUrl: string | null }) => setSrInfo(data))
			.catch(() => {})
		fetch(`/api/game-media?romPath=${encodeURIComponent(game.romPath)}`)
			.then((r) => r.json())
			.then((data: GameMedia) => setMedia(data))
			.catch(() => {})
	}, [game.romPath])

	const screenshotUrl =
		mediaUrl(media?.screenshotPath) ?? mediaUrl(media?.imagePath) ?? mediaUrl(game.imagePath)
	const boxUrl = mediaUrl(media?.thumbnailPath)
	const showBox = !!boxUrl && !boxFailed
	const showShot = !!screenshotUrl && !shotFailed

	const meta = [
		media?.releaseYear ? String(media.releaseYear) : null,
		media?.genre,
		media?.players ? `${media.players}P` : null,
	]
		.filter(Boolean)
		.join('  ·  ')

	return (
		<Card className="gap-0 overflow-hidden p-0">
			{/* Screen stage */}
			<div className="relative aspect-video w-full bg-gradient-to-br from-slate-700 to-slate-950">
				{showShot ? (
					<Image
						src={screenshotUrl as string}
						alt={game.gameName}
						fill
						sizes="(max-width: 1024px) 100vw, 560px"
						className="object-contain"
						unoptimized
						onError={() => setShotFailed(true)}
					/>
				) : (
					<div className="flex h-full items-center justify-center">
						<Gamepad2 className="size-12 text-white/30" />
					</div>
				)}

				{/* Legibility gradient */}
				<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30" />

				{/* Status badge */}
				<div className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 backdrop-blur-sm">
					{game.fromScreensaver ? <DemoBadge /> : <LiveBadge />}
				</div>

				{/* Elapsed timer */}
				<div className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium tabular-nums text-white backdrop-blur-sm">
					{elapsed}
				</div>

				{/* Favorite star */}
				{media?.favorite && (
					<div className="absolute right-3 top-11 rounded-full bg-black/55 p-1.5 backdrop-blur-sm">
						<Star className="size-3.5 fill-yellow-400 text-yellow-400" />
					</div>
				)}

				{/* Box art */}
				{showBox && (
					<Image
						src={boxUrl as string}
						alt=""
						width={120}
						height={160}
						className="absolute bottom-3 left-3 h-28 w-auto -rotate-3 rounded-md shadow-2xl ring-1 ring-black/30"
						unoptimized
						onError={() => setBoxFailed(true)}
					/>
				)}

				{/* Title */}
				<div className={cn('absolute right-3 bottom-3', showBox ? 'left-28 pl-3' : 'left-3')}>
					<p className="truncate text-lg font-bold text-white drop-shadow-md">{game.gameName}</p>
					{meta && <p className="truncate text-xs text-white/70">{meta}</p>}
				</div>
			</div>

			{/* Meta footer */}
			<div className="flex flex-wrap items-center gap-2 p-4">
				<Badge variant="secondary" className="text-xs">
					{game.systemFullName}
				</Badge>
				{game.emulator && <span className="text-xs text-muted-foreground">{game.emulator}</span>}
				{srInfo.srHasPage === 1 && (
					<SuperRetrogamersLink srHasPage={srInfo.srHasPage} srUrl={srInfo.srUrl} variant="icon" />
				)}
			</div>
		</Card>
	)
}

/** Real console brand logo from the Recalbox theme, with an emoji fallback when it can't load. */
function SystemLogo({ systemId }: { systemId: string }) {
	const [failed, setFailed] = useState(false)
	if (failed || !systemId) {
		return <span className="text-4xl leading-none">{systemEmoji(systemId)}</span>
	}
	return (
		<Image
			src={`/api/system-logo?system=${encodeURIComponent(systemId)}`}
			alt=""
			width={96}
			height={96}
			className="w-full h-full object-contain p-2"
			unoptimized
			onError={() => setFailed(true)}
		/>
	)
}

/** "Système en cours" panel: console logo on its theme colors + hardware specs, à la Web Manager. */
function SystemSpecsPanel({
	systemId,
	systemFullName,
}: {
	systemId: string
	systemFullName: string
}) {
	const t = useTranslations('nowPlaying.specs')
	const specs = getSystemSpecs(systemId)
	const b = specs?.bands
	const gradient = b
		? `linear-gradient(135deg, ${b.band1}, ${b.band2}, ${b.band3}, ${b.band4})`
		: 'linear-gradient(135deg, #34495e, #85d6de)'

	const rows = (
		[
			['manufacturer', specs?.manufacturer],
			['year', specs?.yearOfRelease],
			['cpu', specs?.cpu],
			['ram', specs?.ram],
			['audio', specs?.soundChip],
			['video', specs?.video ?? specs?.resolution ?? specs?.display ?? specs?.gpu],
		] as const
	).filter((r): r is readonly [string, string] => Boolean(r[1]))

	return (
		<Card className="gap-0 overflow-hidden p-0">
			<div className="flex h-20 items-center gap-3 px-4" style={{ backgroundImage: gradient }}>
				<div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-black/25 backdrop-blur-sm">
					<SystemLogo systemId={systemId} />
				</div>
				<span className="text-lg font-bold text-white drop-shadow-md">{systemFullName}</span>
			</div>
			{rows.length > 0 && (
				<dl className="divide-y divide-border text-sm">
					{rows.map(([k, v]) => (
						<div key={k} className="flex gap-3 px-4 py-2">
							<dt className="w-28 shrink-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
								{t(k)}
							</dt>
							<dd className="min-w-0 flex-1">{v}</dd>
						</div>
					))}
				</dl>
			)}
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
							<SystemLogo systemId={browsing.system} />
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
		if (currentGame)
			return (
				<div className="space-y-3">
					<SystemSpecsPanel
						systemId={currentGame.system}
						systemFullName={currentGame.systemFullName}
					/>
					<GameCard game={currentGame} />
				</div>
			)
		if (screensaver) return <ScreensaverCard />
		if (browsing)
			return (
				<div className="space-y-3">
					<SystemSpecsPanel systemId={browsing.system} systemFullName={browsing.systemFullName} />
					<BrowsingCard browsing={browsing} />
				</div>
			)
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
