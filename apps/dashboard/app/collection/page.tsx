import Link from 'next/link'
import { getCollectionStats } from '@/lib/db/queries'
import { CollectionGrid } from '@/components/collection-grid'
import { CollectionFilters } from '@/components/collection-filters'
import { SyncButton } from '@/components/sync-button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export default async function CollectionPage() {
	const stats = await getCollectionStats()

	const sortedSystems = Object.entries(stats.bySystem).sort((a, b) => b[1] - a[1])

	return (
		<div className="container mx-auto max-w-screen-2xl space-y-6 px-4 py-8">
			{/* Header */}
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold">Collection</h1>
					<p className="text-sm text-muted-foreground">
						{stats.totalGames.toLocaleString('fr-FR')} jeux ·{' '}
						{stats.favorites} favoris · {stats.neverPlayed} jamais joués ·{' '}
						{sortedSystems.length} systèmes
					</p>
				</div>
				<SyncButton />
			</div>

			<Separator />

			{/* System badges */}
			{sortedSystems.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{sortedSystems.map(([system, count]) => (
						<Link key={system} href={`/collection/${system}`}>
							<Badge variant="secondary" className="cursor-pointer hover:bg-accent">
								{system} · {count}
							</Badge>
						</Link>
					))}
				</div>
			)}

			<Separator />

			{/* Filters */}
			<Suspense>
				<CollectionFilters />
			</Suspense>


			{/* Game grid */}
			<CollectionGrid />
		</div>
	)
}
