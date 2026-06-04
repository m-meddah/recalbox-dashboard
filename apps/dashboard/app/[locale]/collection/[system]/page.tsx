import { CollectionFilters } from '@/components/collection-filters'
import { CollectionGrid } from '@/components/collection-grid'
import { SyncButton } from '@/components/sync-button'
import { SystemSelector } from '@/components/system-selector'
import { Separator } from '@/components/ui/separator'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { getCollectionStats } from '@/lib/db/queries'
import { ChevronRight } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ system: string; locale: string }>
}

export default async function SystemCollectionPage({ params }: Props) {
	const { system, locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	const [stats, t] = await Promise.all([getCollectionStats(), getTranslations('collection')])
	const gameCount = stats.bySystem[system] ?? 0

	const sortedSystems = Object.entries(stats.bySystem)
		.sort((a, b) => b[1] - a[1])
		.map(([name, count]) => ({ name, count }))

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

			{/* Header */}
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold capitalize">{system}</h1>
					<p className="text-sm text-muted-foreground">{t('totalGames', { count: gameCount })}</p>
				</div>
				<SyncButton system={system} />
			</div>

			<Separator />

			{/* System selector + Filters */}
			<div className="flex flex-wrap items-center gap-3">
				<SystemSelector systems={sortedSystems} currentSystem={system} />
				<Separator orientation="vertical" className="h-8" />
				<Suspense>
					<CollectionFilters system={system} />
				</Suspense>
			</div>

			{/* Game grid */}
			<CollectionGrid system={system} />
		</div>
	)
}
