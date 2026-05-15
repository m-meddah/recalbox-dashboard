import { routing } from '@/i18n/routing'
import { CollectionFilters } from '@/components/collection-filters'
import { CollectionGrid } from '@/components/collection-grid'
import { SyncButton } from '@/components/sync-button'
import { SystemSelector } from '@/components/system-selector'
import { Separator } from '@/components/ui/separator'
import { getCollectionStats } from '@/lib/db/queries'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ locale: string }>
}

export default async function CollectionPage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	const [stats, t] = await Promise.all([getCollectionStats(), getTranslations('collection')])

	const sortedSystems = Object.entries(stats.bySystem)
		.sort((a, b) => b[1] - a[1])
		.map(([name, count]) => ({ name, count }))

	return (
		<div className="container mx-auto max-w-screen-2xl space-y-6 px-4 py-8">
			{/* Header */}
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold">{t('title')}</h1>
					<p className="text-sm text-muted-foreground">
						{t('gamesCount', { count: stats.totalGames })} ·{' '}
						{t('favoritesCount', { count: stats.favorites })} ·{' '}
						{t('neverPlayedCount', { count: stats.neverPlayed })} ·{' '}
						{t('systemsCount', { count: sortedSystems.length })}
					</p>
				</div>
				<SyncButton />
			</div>

			<Separator />

			{/* System selector + Filters */}
			<div className="flex flex-wrap items-center gap-3">
				<SystemSelector systems={sortedSystems} />
				<Separator orientation="vertical" className="h-8" />
				<Suspense>
					<CollectionFilters />
				</Suspense>
			</div>

			{/* Game grid */}
			<CollectionGrid />
		</div>
	)
}
