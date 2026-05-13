'use client'

import { Card, CardContent } from '@/components/ui/card'
import type { Game } from '@/lib/db/queries'
import { cn } from '@/lib/utils'
import { Play, Star } from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'

type Props = {
	game: Game
}

function formatRating(rating: number | null): string {
	if (rating === null) return ''
	return `${Math.round(rating * 100)}%`
}

function formatDate(d: Date | null): string {
	if (!d) return ''
	return new Date(d).getFullYear().toString()
}

export function GameCard({ game }: Props) {
	const [imgError, setImgError] = useState(false)
	const coverSrc =
		game.imagePath && !imgError ? `/api/media?path=${encodeURIComponent(game.imagePath)}` : null

	return (
		<Card className="group relative overflow-hidden transition-shadow hover:shadow-lg">
			{/* Cover */}
			<div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
				{coverSrc ? (
					<Image
						src={coverSrc}
						alt={game.name}
						fill
						sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
						className="object-contain transition-transform duration-300 group-hover:scale-105"
						unoptimized
						onError={() => setImgError(true)}
					/>
				) : (
					<div className="flex h-full items-center justify-center text-4xl text-muted-foreground">
						🎮
					</div>
				)}

				{/* Favorite badge */}
				{game.favorite && (
					<div className="absolute right-1 top-1 rounded-full bg-yellow-400 p-1 shadow">
						<Star className="h-3 w-3 fill-white text-white" />
					</div>
				)}

				{/* Rating overlay */}
				{game.rating !== null && (
					<div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
						{formatRating(game.rating)}
					</div>
				)}
			</div>

			<CardContent className="p-2">
				<p className="truncate text-sm font-medium leading-tight" title={game.name}>
					{game.name}
				</p>

				<div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
					{game.releaseDate && <span>{formatDate(game.releaseDate as unknown as Date)}</span>}
					{game.genre && (
						<>
							<span>·</span>
							<span className="truncate">{game.genre!.split('/').at(0)?.trim()}</span>
						</>
					)}
				</div>

				<div className="mt-1 flex items-center gap-1.5 flex-wrap">
					{game.region && (
						<span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
							{game.region}
						</span>
					)}
					{(game.playCount ?? 0) > 0 && (
						<span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
							<Play className="h-2.5 w-2.5" />
							{game.playCount}×
						</span>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
