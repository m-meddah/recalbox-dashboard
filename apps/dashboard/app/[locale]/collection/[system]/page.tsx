import { GameTable } from '@/components/game-table'
import { SyncButton } from '@/components/sync-button'
import { SystemLogo } from '@/components/system-grid'
import { Separator } from '@/components/ui/separator'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { getCollectionStats, listRegions } from '@/lib/db/queries'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { ChevronRight } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ system: string; locale: string }>
}

export default async function SystemCollectionPage({ params }: Props) {
	const { system, locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	const recalboxId = await getActiveRecalboxId()
	const [stats, t, regions] = await Promise.all([
		getCollectionStats(),
		getTranslations('collection'),
		listRegions(system, recalboxId ?? undefined),
	])
	const gameCount = stats.bySystem[system] ?? 0

	return (
		<div className="container mx-auto max-w-6xl space-y-6 px-4 py-8">
			{/* Breadcrumb */}
			<nav className="flex items-center gap-1 text-sm text-muted-foreground">
				<Link href="/collection" className="hover:text-foreground">
					{t('breadcrumb')}
				</Link>
				<ChevronRight className="size-4" />
				<span className="font-medium text-foreground capitalize">{system}</span>
			</nav>

			{/* Header: system logo + name */}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<SystemLogo system={system} className="h-12 w-20 shrink-0 rounded-md p-2" />
					<div>
						<h1 className="text-2xl font-bold capitalize">{system}</h1>
						<p className="text-sm text-muted-foreground">{t('totalGames', { count: gameCount })}</p>
					</div>
				</div>
				<SyncButton system={system} />
			</div>

			<Separator />

			{/* Games table */}
			<GameTable system={system} regions={regions} />
		</div>
	)
}
