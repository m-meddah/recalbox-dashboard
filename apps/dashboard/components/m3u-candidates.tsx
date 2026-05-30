'use client'

import type { MultiDiscGame } from '@/lib/recalbox/multidisc-detector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertTriangle, CheckCircle2, CircleDotDashed, FileText, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type CandidatesData = { candidates: MultiDiscGame[]; systems: string[] }

type GenerateEntry = Pick<MultiDiscGame, 'system' | 'baseName' | 'romsDir' | 'discs'>

type ConfirmState = {
	game: MultiDiscGame
	expectedContent: string
} | null

function gameStatus(g: MultiDiscGame): 'ok' | 'missing' | 'gap' | 'differs' {
	if (!g.m3uAlreadyExists) return g.hasGap ? 'gap' : 'missing'
	return 'ok'
}

function m3uPreview(g: MultiDiscGame): string {
	return g.discs.map((d) => d.fileName).join('\n') + '\n'
}

export function M3uCandidates() {
	const t = useTranslations('m3u')
	const [data, setData] = useState<CandidatesData | null>(null)
	const [loading, setLoading] = useState(true)
	const [generatingKeys, setGeneratingKeys] = useState<Set<string>>(new Set())
	const [confirm, setConfirm] = useState<ConfirmState>(null)
	const [banner, setBanner] = useState(false)

	useEffect(() => {
		fetch('/api/m3u/candidates')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then(setData)
			.catch(() => setData({ candidates: [], systems: [] }))
			.finally(() => setLoading(false))
	}, [])

	const gameKey = (g: MultiDiscGame) => `${g.system}|${g.romsDir}|${g.baseName}`

	const generate = async (games: GenerateEntry[], force = false) => {
		const keys = games.map((g) => `${g.system}|${g.romsDir}|${g.baseName}`)
		setGeneratingKeys((prev) => new Set([...prev, ...keys]))

		try {
			const res = await fetch('/api/m3u/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ games: games.map((g) => ({ ...g, force })) }),
			}).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))

			const freshRes = await fetch('/api/m3u/candidates')
			const fresh: CandidatesData = freshRes.ok
				? await freshRes.json()
				: { candidates: data?.candidates ?? [], systems: data?.systems ?? [] }
			setData(fresh)

			if (res.summary?.created > 0) setBanner(true)
			return res
		} finally {
			setGeneratingKeys(new Set())
		}
	}

	const handleUpdate = (g: MultiDiscGame) => {
		setConfirm({ game: g, expectedContent: m3uPreview(g) })
	}

	const batchMissing = () => {
		if (!data) return
		const missing = data.candidates.filter((g) => !g.m3uAlreadyExists)
		generate(missing)
	}

	if (loading) {
		return (
			<div className="space-y-4">
				{[1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-24 w-full rounded-lg" />
				))}
			</div>
		)
	}

	if (!data || data.candidates.length === 0) {
		return <p className="text-sm text-muted-foreground">{t('noGames')}</p>
	}

	const totalMissing = data.candidates.filter((g) => !g.m3uAlreadyExists).length
	const bySystem = data.candidates.reduce<Record<string, MultiDiscGame[]>>((acc, g) => {
		;(acc[g.system] ??= []).push(g)
		return acc
	}, {})

	return (
		<TooltipProvider>
			<div className="space-y-6">
				{/* Summary bar */}
				<div className="flex flex-wrap items-center justify-between gap-4">
					<p className="text-sm text-muted-foreground">
						{t('subtitle', {
							games: data.candidates.length,
							systems: Object.keys(bySystem).length,
							missing: totalMissing,
						})}
					</p>
					{totalMissing > 0 && (
						<Button onClick={batchMissing} disabled={generatingKeys.size > 0}>
							{generatingKeys.size > 0 ? t('generating') : t('generateMissing')}
						</Button>
					)}
				</div>

				{/* Per-system sections */}
				{Object.entries(bySystem).map(([system, sysGames]) => {
					const sysMissing = sysGames.filter((g) => !g.m3uAlreadyExists).length
					return (
						<div key={system} className="space-y-2">
							<div className="flex items-center gap-2">
								<h2 className="font-semibold capitalize">{system}</h2>
								<span className="text-sm text-muted-foreground">
									{sysGames.length} games · {sysMissing} missing
								</span>
							</div>

							<div className="divide-y rounded-md border">
								{sysGames.map((g) => {
									const status = gameStatus(g)
									const key = gameKey(g)
									const isGenerating = generatingKeys.has(key)
									const preview = m3uPreview(g)

									return (
										<div key={key} className="flex items-center gap-3 px-4 py-2">
											{/* Status icon */}
											<span className="shrink-0">
												{status === 'ok' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
												{status === 'missing' && <XCircle className="h-4 w-4 text-amber-500" />}
												{status === 'gap' && (
													<Tooltip>
														<TooltipTrigger>
															<AlertTriangle className="h-4 w-4 text-orange-500" />
														</TooltipTrigger>
														<TooltipContent>{t('status.gap')}</TooltipContent>
													</Tooltip>
												)}
												{status === 'differs' && (
													<CircleDotDashed className="h-4 w-4 text-blue-500" />
												)}
											</span>

											{/* Game name */}
											<span className="flex-1 truncate text-sm">{g.baseName}</span>

											{/* Disc count */}
											<Badge variant="outline" className="shrink-0 text-xs">
												{t('discs', { count: g.discs.length })}
											</Badge>

											{/* Status badge */}
											<Badge
												variant={status === 'ok' ? 'secondary' : 'outline'}
												className="shrink-0 text-xs"
											>
												{t(`status.${status}` as Parameters<typeof t>[0])}
											</Badge>

											{/* Preview popover */}
											<Popover>
												<PopoverTrigger
													className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground"
													aria-label={t('preview')}
												>
													<FileText className="h-3 w-3" />
												</PopoverTrigger>
												<PopoverContent className="w-auto max-w-sm">
													<pre className="whitespace-pre font-mono text-xs">{preview}</pre>
												</PopoverContent>
											</Popover>

											{/* Action button */}
											{status !== 'ok' && (
												<Button
													size="sm"
													variant={status === 'differs' ? 'outline' : 'default'}
													className="shrink-0"
													disabled={isGenerating}
													onClick={() => (status === 'differs' ? handleUpdate(g) : generate([g]))}
												>
													{isGenerating
														? t('generating')
														: status === 'differs'
															? t('actions.update')
															: t('actions.generate')}
												</Button>
											)}
										</div>
									)
								})}
							</div>
						</div>
					)
				})}

				{/* Re-scan banner */}
				{banner && (
					<p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
						{t('rescanNote')}
					</p>
				)}

				{/* Confirm overwrite dialog */}
				<Dialog open={confirm !== null} onOpenChange={() => setConfirm(null)}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t('actions.confirmUpdate')}</DialogTitle>
						</DialogHeader>
						{confirm && (
							<div className="space-y-3 text-sm">
								<div>
									<p className="mb-1 font-medium">{t('diffExpected')}</p>
									<pre className="rounded bg-muted px-3 py-2 font-mono text-xs whitespace-pre">
										{confirm.expectedContent}
									</pre>
								</div>
							</div>
						)}
						<DialogFooter>
							<Button variant="outline" onClick={() => setConfirm(null)}>
								{t('actions.cancel')}
							</Button>
							<Button
								onClick={() => {
									if (confirm) {
										generate([confirm.game], true)
										setConfirm(null)
									}
								}}
							>
								{t('actions.confirmUpdate')}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</TooltipProvider>
	)
}
