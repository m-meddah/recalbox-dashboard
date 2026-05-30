'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Check, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { IgdbCandidate } from '@/lib/igdb/match-game'

type ReviewItem = {
	gameId: number
	gameName: string
	system: string
	igdbId: number | null
	igdbName: string | null
	confidence: number | null
	method: string | null
	candidates: IgdbCandidate[]
}

export default function IgdbReviewPage() {
	const t = useTranslations('settings')
	const router = useRouter()
	const [items, setItems] = useState<ReviewItem[]>([])
	const [loading, setLoading] = useState(true)
	const [acting, setActing] = useState<number | null>(null)
	const [manualOpen, setManualOpen] = useState<Map<number, boolean>>(new Map())
	const [manualInput, setManualInput] = useState<Map<number, string>>(new Map())

	useEffect(() => {
		fetch('/api/igdb/review')
			.then((r) => r.json())
			.then((data: { items: ReviewItem[] }) => {
				setItems(data.items)
				setLoading(false)
			})
			.catch(() => setLoading(false))
	}, [])

	async function handleSelect(gameId: number, candidate: IgdbCandidate) {
		setActing(gameId)
		try {
			const res = await fetch('/api/igdb/review/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					gameId,
					action: 'manual',
					igdbId: candidate.igdbId,
					igdbName: candidate.igdbName,
				}),
			})
			if (res.ok) {
				setItems((prev) => prev.filter((item) => item.gameId !== gameId))
			}
		} finally {
			setActing(null)
		}
	}

	async function handleManual(gameId: number) {
		const rawId = manualInput.get(gameId)?.trim()
		const igdbId = rawId ? Number(rawId) : NaN
		if (!igdbId || isNaN(igdbId)) return
		setActing(gameId)
		try {
			const res = await fetch('/api/igdb/review/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ gameId, action: 'manual', igdbId, igdbName: 'Manual entry' }),
			})
			if (res.ok) {
				setItems((prev) => prev.filter((item) => item.gameId !== gameId))
			}
		} finally {
			setActing(null)
		}
	}

	async function handleReject(gameId: number) {
		setActing(gameId)
		try {
			const res = await fetch('/api/igdb/review/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ gameId, action: 'reject' }),
			})
			if (res.ok) {
				setItems((prev) => prev.filter((item) => item.gameId !== gameId))
			}
		} finally {
			setActing(null)
		}
	}

	return (
		<div className="container max-w-4xl mx-auto p-6 space-y-6">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="sm" onClick={() => router.back()}>
					<ArrowLeft className="w-4 h-4 mr-1" />
					{t('igdbReview.back')}
				</Button>
				<div>
					<h1 className="text-2xl font-bold">{t('igdbReview.title')}</h1>
					<p className="text-sm text-muted-foreground">{t('igdbReview.subtitle')}</p>
				</div>
			</div>

			{loading && <p className="text-muted-foreground text-sm">{t('igdbReview.loading')}</p>}

			{!loading && items.length === 0 && (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground text-sm">
						{t('igdbReview.allGood')}
					</CardContent>
				</Card>
			)}

			{!loading && items.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>{t('igdbReview.pendingTitle', { count: items.length })}</CardTitle>
					</CardHeader>
					<CardContent className="p-0">
						<div className="divide-y">
							{items.map((item) => (
								<div key={item.gameId} className="px-4 py-4 space-y-3">
									<div>
										<p className="font-medium text-sm">{item.gameName}</p>
										<p className="text-xs text-muted-foreground">{item.system}</p>
									</div>

									{item.candidates.length > 0 ? (
										<div className="space-y-1.5">
											{item.candidates.map((candidate, i) => (
												<div
													key={candidate.igdbId}
													className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
												>
													<div className="flex-1 min-w-0">
														<span className="truncate block">{candidate.igdbName}</span>
													</div>
													<Badge
														variant={i === 0 ? 'default' : 'secondary'}
														className="text-xs shrink-0"
													>
														{Math.round(candidate.confidence * 100)}%
													</Badge>
													<Button
														size="sm"
														variant={i === 0 ? 'default' : 'outline'}
														disabled={acting === item.gameId}
														onClick={() => handleSelect(item.gameId, candidate)}
														aria-label={candidate.igdbName}
													>
														<Check className="w-3.5 h-3.5" />
													</Button>
												</div>
											))}
											<Button
												size="sm"
												variant="ghost"
												className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full"
												disabled={acting === item.gameId}
												onClick={() => handleReject(item.gameId)}
											>
												<X className="w-3.5 h-3.5 mr-1" />
												{t('igdbReview.none')}
											</Button>
										</div>
									) : (
										<div className="flex items-center gap-3 text-sm">
											<span className="flex-1 text-muted-foreground truncate">
												{item.igdbName ?? '—'}
												{item.confidence != null && (
													<span className="text-xs ml-1">
														({Math.round(item.confidence * 100)}%)
													</span>
												)}
											</span>
											<Button
												size="sm"
												variant="outline"
												className="text-green-600 border-green-200 hover:bg-green-50"
												disabled={acting === item.gameId}
												onClick={() => {
													if (item.igdbId && item.igdbName) {
														handleSelect(item.gameId, {
															igdbId: item.igdbId,
															igdbName: item.igdbName,
															confidence: item.confidence ?? 0,
														})
													} else {
														handleReject(item.gameId)
													}
												}}
												aria-label={item.igdbName ?? undefined}
											>
												<Check className="w-3.5 h-3.5" />
											</Button>
											<Button
												size="sm"
												variant="outline"
												className="text-red-600 border-red-200 hover:bg-red-50"
												disabled={acting === item.gameId}
												onClick={() => handleReject(item.gameId)}
											>
												<X className="w-3.5 h-3.5" />
											</Button>
										</div>
									)}

								<div className="pt-1">
									{manualOpen.get(item.gameId) ? (
										<div className="flex items-center gap-2">
											<input
												type="number"
												className="flex h-8 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
												placeholder="IGDB ID"
												value={manualInput.get(item.gameId) ?? ''}
												onChange={(e) =>
													setManualInput((prev) => new Map(prev).set(item.gameId, e.target.value))
												}
												disabled={acting === item.gameId}
											/>
											<Button
												size="sm"
												variant="secondary"
												disabled={acting === item.gameId || !manualInput.get(item.gameId)?.trim()}
												onClick={() => handleManual(item.gameId)}
											>
												{t('igdbReview.manualSubmit')}
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onClick={() => setManualOpen((prev) => new Map(prev).set(item.gameId, false))}
											>
												{t('igdbReview.manualCancel')}
											</Button>
										</div>
									) : (
										<button
											type="button"
											className="text-xs text-muted-foreground underline-offset-2 hover:underline"
											onClick={() => setManualOpen((prev) => new Map(prev).set(item.gameId, true))}
										>
											{t('igdbReview.manualToggle')}
										</button>
									)}
								</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
