'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { IgdbCandidate } from '@/lib/igdb/match-game'
import { ArrowLeft, Check, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { startTransition, useEffect, useOptimistic, useState } from 'react'

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

type SystemEntry = {
	system: string
	count: number
}

export default function IgdbReviewPage() {
	const t = useTranslations('settings')
	const router = useRouter()

	const [systems, setSystems] = useState<SystemEntry[]>([])
	const [activeSystem, setActiveSystem] = useState<string | null>(null)
	const [items, setItems] = useState<ReviewItem[]>([])
	const [loadingSystems, setLoadingSystems] = useState(true)
	const [loadingItems, setLoadingItems] = useState(false)
	const [manualOpen, setManualOpen] = useState<Map<number, boolean>>(new Map())
	const [manualInput, setManualInput] = useState<Map<number, string>>(new Map())

	const [optimisticItems, removeOptimistic] = useOptimistic(
		items,
		(state: ReviewItem[], gameId: number) => state.filter((item) => item.gameId !== gameId),
	)

	// Load systems list on mount
	useEffect(() => {
		fetch('/api/igdb/review/systems')
			.then((r) => r.json())
			.then((data: { systems: SystemEntry[] }) => {
				setSystems(data.systems)
				if (data.systems.length > 0) {
					setActiveSystem(data.systems[0]!.system)
				}
				setLoadingSystems(false)
			})
			.catch(() => setLoadingSystems(false))
	}, [])

	// Load items when active system changes
	useEffect(() => {
		if (!activeSystem) return
		setLoadingItems(true)
		fetch(`/api/igdb/review?system=${encodeURIComponent(activeSystem)}`)
			.then((r) => r.json())
			.then((data: { items: ReviewItem[] }) => {
				setItems(data.items)
				setLoadingItems(false)
			})
			.catch(() => setLoadingItems(false))
	}, [activeSystem])

	function afterConfirm(gameId: number, confirmedSystem: string) {
		setItems((prev) => prev.filter((item) => item.gameId !== gameId))
		setSystems((prev) => {
			const updated = prev
				.map((s) =>
					s.system === confirmedSystem ? { ...s, count: s.count - 1 } : s,
				)
				.filter((s) => s.count > 0)
			const stillActive = updated.find((s) => s.system === confirmedSystem)
			if (!stillActive) {
				setActiveSystem(updated[0]?.system ?? null)
			}
			return updated
		})
	}

	function handleSelect(gameId: number, candidate: IgdbCandidate) {
		const confirmedSystem = activeSystem ?? ''
		startTransition(async () => {
			removeOptimistic(gameId)
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
			if (res.ok) afterConfirm(gameId, confirmedSystem)
		})
	}

	function handleManual(gameId: number) {
		const rawId = manualInput.get(gameId)?.trim()
		const igdbId = rawId ? Number(rawId) : Number.NaN
		if (!igdbId || Number.isNaN(igdbId)) return
		const confirmedSystem = activeSystem ?? ''
		startTransition(async () => {
			removeOptimistic(gameId)
			const res = await fetch('/api/igdb/review/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ gameId, action: 'manual', igdbId, igdbName: 'Manual entry' }),
			})
			if (res.ok) afterConfirm(gameId, confirmedSystem)
		})
	}

	function handleReject(gameId: number) {
		const confirmedSystem = activeSystem ?? ''
		startTransition(async () => {
			removeOptimistic(gameId)
			const res = await fetch('/api/igdb/review/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ gameId, action: 'reject' }),
			})
			if (res.ok) afterConfirm(gameId, confirmedSystem)
		})
	}

	return (
		<div className="container max-w-5xl mx-auto p-6 space-y-6">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="sm" onClick={() => router.back()}>
					<ArrowLeft className="size-4 mr-1" />
					{t('igdbReview.back')}
				</Button>
				<div>
					<h1 className="text-2xl font-bold">{t('igdbReview.title')}</h1>
					<p className="text-sm text-muted-foreground">{t('igdbReview.subtitle')}</p>
				</div>
			</div>

			{loadingSystems && (
				<p className="text-muted-foreground text-sm">{t('igdbReview.loading')}</p>
			)}

			{!loadingSystems && systems.length === 0 && (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground text-sm">
						{t('igdbReview.allGood')}
					</CardContent>
				</Card>
			)}

			{!loadingSystems && systems.length > 0 && (
				<div className="flex gap-4 items-start">
					{/* Sidebar */}
					<nav className="w-52 shrink-0">
						<Card>
							<CardContent className="p-2">
								<ul className="space-y-0.5">
									{systems.map((s) => (
										<li key={s.system}>
											<button
												type="button"
												onClick={() => setActiveSystem(s.system)}
												className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm text-left transition-colors ${
													s.system === activeSystem
														? 'bg-primary text-primary-foreground'
														: 'hover:bg-muted'
												}`}
											>
												<span className="truncate">{s.system}</span>
												<Badge
													variant={s.system === activeSystem ? 'secondary' : 'outline'}
													className="ml-2 shrink-0 text-xs"
												>
													{s.count}
												</Badge>
											</button>
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					</nav>

					{/* Content area */}
					<div className="flex-1 min-w-0">
						{loadingItems && (
							<p className="text-muted-foreground text-sm">{t('igdbReview.loading')}</p>
						)}

						{!loadingItems && optimisticItems.length === 0 && (
							<Card>
								<CardContent className="py-8 text-center text-muted-foreground text-sm">
									{t('igdbReview.allGood')}
								</CardContent>
							</Card>
						)}

						{!loadingItems && optimisticItems.length > 0 && (
							<Card>
								<CardHeader>
									<CardTitle>
										{t('igdbReview.pendingTitle', { count: optimisticItems.length })}
									</CardTitle>
								</CardHeader>
								<CardContent className="p-0">
									<div className="divide-y">
										{optimisticItems.map((item) => (
											<ReviewItemRow
												key={item.gameId}
												item={item}
												manualOpen={manualOpen.get(item.gameId) ?? false}
												manualValue={manualInput.get(item.gameId) ?? ''}
												onSelect={(candidate) => handleSelect(item.gameId, candidate)}
												onReject={() => handleReject(item.gameId)}
												onManualSubmit={() => handleManual(item.gameId)}
												onManualToggle={(open) =>
													setManualOpen((prev) => new Map(prev).set(item.gameId, open))
												}
												onManualChange={(value) =>
													setManualInput((prev) => new Map(prev).set(item.gameId, value))
												}
												t={t}
											/>
										))}
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

function ReviewItemRow({
	item,
	manualOpen,
	manualValue,
	onSelect,
	onReject,
	onManualSubmit,
	onManualToggle,
	onManualChange,
	t,
}: {
	item: ReviewItem
	manualOpen: boolean
	manualValue: string
	onSelect: (candidate: IgdbCandidate) => void
	onReject: () => void
	onManualSubmit: () => void
	onManualToggle: (open: boolean) => void
	onManualChange: (value: string) => void
	t: ReturnType<typeof useTranslations<'settings'>>
}) {
	return (
		<div className="p-4 space-y-3">
			<div>
				<p className="font-medium text-sm">{item.gameName}</p>
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
								onClick={() => onSelect(candidate)}
								aria-label={candidate.igdbName}
							>
								<Check className="size-3.5" />
							</Button>
						</div>
					))}
					<Button
						size="sm"
						variant="ghost"
						className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full"
						onClick={onReject}
					>
						<X className="size-3.5 mr-1" />
						{t('igdbReview.none')}
					</Button>
				</div>
			) : (
				<div className="flex items-center gap-3 text-sm">
					<span className="flex-1 text-muted-foreground truncate">
						{item.igdbName ?? '—'}
						{item.confidence != null && (
							<span className="text-xs ml-1">({Math.round(item.confidence * 100)}%)</span>
						)}
					</span>
					<Button
						size="sm"
						variant="outline"
						className="text-green-600 border-green-200 hover:bg-green-50"
						onClick={() => {
							if (item.igdbId && item.igdbName) {
								onSelect({ igdbId: item.igdbId, igdbName: item.igdbName, confidence: item.confidence ?? 0 })
							} else {
								onReject()
							}
						}}
						aria-label={item.igdbName ?? undefined}
					>
						<Check className="size-3.5" />
					</Button>
					<Button
						size="sm"
						variant="outline"
						className="text-red-600 border-red-200 hover:bg-red-50"
						onClick={onReject}
					>
						<X className="size-3.5" />
					</Button>
				</div>
			)}

			<div className="pt-1">
				{manualOpen ? (
					<div className="flex items-center gap-2">
						<input
							type="number"
							className="flex h-8 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
							placeholder="IGDB ID"
							aria-label="IGDB ID"
							value={manualValue}
							onChange={(e) => onManualChange(e.target.value)}
						/>
						<Button
							size="sm"
							variant="secondary"
							disabled={!manualValue.trim()}
							onClick={onManualSubmit}
						>
							{t('igdbReview.manualSubmit')}
						</Button>
						<Button size="sm" variant="ghost" onClick={() => onManualToggle(false)}>
							{t('igdbReview.manualCancel')}
						</Button>
					</div>
				) : (
					<button
						type="button"
						className="text-xs text-muted-foreground underline-offset-2 hover:underline"
						onClick={() => onManualToggle(true)}
					>
						{t('igdbReview.manualToggle')}
					</button>
				)}
			</div>
		</div>
	)
}
