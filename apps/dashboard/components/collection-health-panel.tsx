import type { CollectionHealth, ScrapeStatus } from '@/lib/collection-health'
import type { PatronStatus } from '@/lib/recalbox/patron-status'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Link } from '@/i18n/navigation'
import { AlertTriangle, CheckCircle2, ChevronDown, FileText, ImageOff, ShieldCheck } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

type Props = {
	health: CollectionHealth
	patron: PatronStatus
}

function groupBySystem(games: ScrapeStatus[]): Map<string, ScrapeStatus[]> {
	const map = new Map<string, ScrapeStatus[]>()
	for (const g of games) {
		const arr = map.get(g.system) ?? []
		arr.push(g)
		map.set(g.system, arr)
	}
	return map
}

export async function CollectionHealthPanel({ health, patron }: Props) {
	const t = await getTranslations('health')

	const scrapePct =
		health.totalGames > 0 ? Math.round((health.fullyScraped / health.totalGames) * 100) : 100
	const allScraped = health.missingMedia === 0
	const bySystem = groupBySystem(health.unscrapedGames)

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center gap-2 text-base">
					{allScraped ? (
						<CheckCircle2 className="h-4 w-4 text-green-500" />
					) : (
						<AlertTriangle className="h-4 w-4 text-orange-500" />
					)}
					{t('title')}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Progress bar + collapsible game list */}
				<div className="space-y-1.5">
					<div className="flex items-center justify-between text-sm">
						<span className="font-medium">{t('scraping.label')}</span>
						<span className="tabular-nums text-muted-foreground">{scrapePct}%</span>
					</div>
					<Progress value={scrapePct} />

					{allScraped ? (
						<p className="text-sm text-muted-foreground">{t('scraping.allDone')}</p>
					) : (
						<details className="group w-full">
							<summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors select-none">
								<span>
									{t('scraping.gamesWithoutMedia', {
										count: health.missingMedia,
										total: health.totalGames,
									})}
								</span>
								<ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-180" />
							</summary>
							<div className="mt-1 max-h-72 overflow-y-auto rounded-md border">
								{Array.from(bySystem.entries()).map(([system, games]) => (
									<div key={system}>
										<Link
											href={`/collection/${system}`}
											className="flex items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50 hover:bg-muted transition-colors sticky top-0"
										>
											<span>{system}</span>
											<span className="tabular-nums">{games.length}</span>
										</Link>
										<ul>
											{games.map((g) => (
												<li
													key={g.romPath}
													className="flex items-center justify-between gap-2 px-3 py-1 text-sm border-t border-border/50"
												>
													<span className="truncate">{g.name}</span>
													<span className="flex shrink-0 gap-1">
														{g.missingImage && (
															<Badge variant="secondary" className="gap-1 text-xs font-normal">
																<ImageOff className="h-3 w-3" />
																{t('scraping.noImage')}
															</Badge>
														)}
														{g.missingDescription && (
															<Badge variant="secondary" className="gap-1 text-xs font-normal">
																<FileText className="h-3 w-3" />
																{t('scraping.noDesc')}
															</Badge>
														)}
													</span>
												</li>
											))}
										</ul>
									</div>
								))}
							</div>
						</details>
					)}
				</div>

				{/* Patron status */}
				{patron.keyPresent && !patron.keyLooksValid ? (
					<div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-400">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<span>
							{t('patron.invalidKey')}{' '}
							<a
								href={`http://${process.env.RECALBOX_HOST ?? 'recalbox.local'}`}
								target="_blank"
								rel="noopener noreferrer"
								className="underline underline-offset-2"
							>
								{t('patron.webManagerLink')}
							</a>
						</span>
					</div>
				) : patron.isPatron ? (
					<div className="flex items-center gap-2">
						<ShieldCheck className="h-4 w-4 text-green-500" />
						<Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400">
							{t('patron.active')}
						</Badge>
					</div>
				) : null}

				{/* Recommendation */}
				<p className={allScraped ? 'text-sm text-green-600 dark:text-green-400' : 'text-sm text-muted-foreground'}>
					{allScraped
						? t('recommendation.allDone')
						: patron.isPatron
							? t('recommendation.withPatron', { count: health.missingMedia })
							: t('recommendation.withoutPatron', { count: health.missingMedia })}
				</p>
			</CardContent>
		</Card>
	)
}
