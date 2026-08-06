'use client'

import { useCanControl } from '@/components/can-control-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { MalformedM3u, MultiDiscGame } from '@/lib/recalbox/multidisc-detector'
import { AlertTriangle, CheckCircle2, CircleDotDashed, FileText, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type CandidatesData = {
	candidates: MultiDiscGame[]
	malformed: MalformedM3u[]
	systems: string[]
}

type GenerateEntry = Pick<MultiDiscGame, 'system' | 'baseName' | 'romsDir' | 'discs'> & {
	m3uFileName?: string
}

type GenerateOptions = { force?: boolean; repair?: boolean }

function gameKey(g: MultiDiscGame) {
	return `${g.system}|${g.romsDir}|${g.baseName}`
}

function gameStatus(g: MultiDiscGame): 'ok' | 'missing' | 'gap' | 'malformed' {
	if (!g.m3uAlreadyExists) return g.hasGap ? 'gap' : 'missing'
	return g.m3uNeedsRepair ? 'malformed' : 'ok'
}

/** A standalone .m3u has no disc group, so it is addressed by its exact filename. */
function malformedEntry(m: MalformedM3u): GenerateEntry {
	return {
		system: m.system,
		baseName: m.m3uFileName.replace(/\.m3u$/i, ''),
		romsDir: m.romsDir,
		discs: [],
		m3uFileName: m.m3uFileName,
	}
}

function m3uPreview(g: MultiDiscGame): string {
	return `${g.discs.map((d) => d.fileName).join('\n')}\n`
}

export function M3uCandidates() {
	const t = useTranslations('m3u')
	const canControl = useCanControl()
	const [data, setData] = useState<CandidatesData | null>(null)
	const [loading, setLoading] = useState(true)
	const [generatingKeys, setGeneratingKeys] = useState<Set<string>>(new Set())
	const [banner, setBanner] = useState(false)

	useEffect(() => {
		fetch('/api/m3u/candidates')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then(setData)
			.catch(() => setData({ candidates: [], malformed: [], systems: [] }))
			.finally(() => setLoading(false))
	}, [])

	const generate = async (games: GenerateEntry[], { force, repair }: GenerateOptions = {}) => {
		const keys = games.map((g) => `${g.system}|${g.romsDir}|${g.baseName}`)
		setGeneratingKeys((prev) => new Set([...prev, ...keys]))

		try {
			const res = await fetch('/api/m3u/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ games: games.map((g) => ({ ...g, force, repair })) }),
			}).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))

			const freshRes = await fetch('/api/m3u/candidates')
			const fresh: CandidatesData = freshRes.ok
				? await freshRes.json()
				: {
						candidates: data?.candidates ?? [],
						malformed: data?.malformed ?? [],
						systems: data?.systems ?? [],
					}
			setData(fresh)

			if (res.summary?.created > 0) setBanner(true)
			return res
		} finally {
			setGeneratingKeys(new Set())
		}
	}

	const batchMissing = () => {
		if (!data) return
		generate(data.candidates.filter((g) => !g.m3uAlreadyExists))
	}

	const batchRepair = () => {
		if (!data) return
		generate(
			[...data.candidates.filter((g) => g.m3uNeedsRepair), ...data.malformed.map(malformedEntry)],
			{ repair: true },
		)
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

	if (!data || (data.candidates.length === 0 && data.malformed.length === 0)) {
		return <p className="text-sm text-muted-foreground">{t('noGames')}</p>
	}

	const totalMissing = data.candidates.filter((g) => !g.m3uAlreadyExists).length
	const totalMalformed =
		data.candidates.filter((g) => g.m3uNeedsRepair).length + data.malformed.length
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
					<div className="flex flex-wrap gap-2">
						{totalMalformed > 0 && (
							<Button
								variant="outline"
								onClick={batchRepair}
								disabled={generatingKeys.size > 0 || !canControl}
							>
								{generatingKeys.size > 0 ? t('generating') : t('repairAll')}
							</Button>
						)}
						{totalMissing > 0 && (
							<Button onClick={batchMissing} disabled={generatingKeys.size > 0 || !canControl}>
								{generatingKeys.size > 0 ? t('generating') : t('generateMissing')}
							</Button>
						)}
					</div>
				</div>

				{/* Per-system sections */}
				{Object.entries(bySystem).map(([system, sysGames]) => {
					const sysMissing = sysGames.filter((g) => !g.m3uAlreadyExists).length
					const sysMalformed = sysGames.filter((g) => g.m3uNeedsRepair).length
					return (
						<div key={system} className="space-y-2">
							<div className="flex items-center gap-2">
								<h2 className="font-semibold capitalize">{system}</h2>
								<span className="text-sm text-muted-foreground">
									{sysGames.length} games · {sysMissing} missing
									{sysMalformed > 0 && ` · ${sysMalformed} malformed`}
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
												{status === 'ok' && <CheckCircle2 className="size-4 text-green-500" />}
												{status === 'missing' && <XCircle className="size-4 text-amber-500" />}
												{status === 'gap' && (
													<Tooltip>
														<TooltipTrigger>
															<AlertTriangle className="size-4 text-orange-500" />
														</TooltipTrigger>
														<TooltipContent>{t('status.gap')}</TooltipContent>
													</Tooltip>
												)}
												{status === 'malformed' && (
													<Tooltip>
														<TooltipTrigger>
															<CircleDotDashed className="size-4 text-red-500" />
														</TooltipTrigger>
														<TooltipContent className="max-w-xs">{t('repairNote')}</TooltipContent>
													</Tooltip>
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
													className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground"
													aria-label={t('preview')}
												>
													<FileText className="size-3" />
												</PopoverTrigger>
												<PopoverContent className="w-auto max-w-sm">
													<pre className="whitespace-pre font-mono text-xs">{preview}</pre>
												</PopoverContent>
											</Popover>

											{/* Action button */}
											{status !== 'ok' && (
												<Button
													size="sm"
													variant={status === 'malformed' ? 'outline' : 'default'}
													className="shrink-0"
													disabled={isGenerating || !canControl}
													onClick={() =>
														status === 'malformed' ? generate([g], { repair: true }) : generate([g])
													}
												>
													{isGenerating
														? t('generating')
														: status === 'malformed'
															? t('actions.repair')
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

				{/* .m3u files with no disc group — the usual case once EmulationStation
				    hides the individual discs */}
				{data.malformed.length > 0 && (
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<h2 className="font-semibold">{t('orphanTitle')}</h2>
							<span className="text-sm text-muted-foreground">
								{data.malformed.length} {t('status.malformed').toLowerCase()}
							</span>
						</div>
						<p className="text-sm text-muted-foreground">{t('repairNote')}</p>
						<div className="divide-y rounded-md border">
							{data.malformed.map((m) => {
								const key = `${m.system}|${m.romsDir}|${m.m3uFileName}`
								return (
									<div key={key} className="flex items-center gap-3 px-4 py-2">
										<CircleDotDashed className="size-4 shrink-0 text-red-500" />
										<span className="flex-1 truncate text-sm">{m.m3uFileName}</span>
										<Badge variant="outline" className="shrink-0 text-xs capitalize">
											{m.system}
										</Badge>
										<Button
											size="sm"
											variant="outline"
											className="shrink-0"
											disabled={generatingKeys.size > 0 || !canControl}
											onClick={() => generate([malformedEntry(m)], { repair: true })}
										>
											{generatingKeys.size > 0 ? t('generating') : t('actions.repair')}
										</Button>
									</div>
								)
							})}
						</div>
					</div>
				)}

				{/* Re-scan banner */}
				{banner && (
					<p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
						{t('rescanNote')}
					</p>
				)}
			</div>
		</TooltipProvider>
	)
}
