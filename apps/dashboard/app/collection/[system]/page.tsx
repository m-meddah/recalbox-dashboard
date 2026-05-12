import Link from 'next/link'
import { getCollectionStats } from '@/lib/db/queries'
import { CollectionGrid } from '@/components/collection-grid'
import { CollectionFilters } from '@/components/collection-filters'
import { SyncButton } from '@/components/sync-button'
import { Separator } from '@/components/ui/separator'
import { ChevronRight } from 'lucide-react'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ system: string }>
}

export default async function SystemCollectionPage({ params }: Props) {
	const { system } = await params
	const stats = await getCollectionStats()
	const gameCount = stats.bySystem[system] ?? 0

	return (
		<div className="container mx-auto max-w-screen-2xl space-y-6 px-4 py-8">
			{/* Breadcrumb */}
			<nav className="flex items-center gap-1 text-sm text-muted-foreground">
				<Link href="/collection" className="hover:text-foreground">
					Collection
				</Link>
				<ChevronRight className="h-4 w-4" />
				<span className="font-medium text-foreground capitalize">{system}</span>
			</nav>

			{/* Header */}
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold capitalize">{system}</h1>
					<p className="text-sm text-muted-foreground">
						{gameCount.toLocaleString('fr-FR')} jeu{gameCount > 1 ? 'x' : ''}
					</p>
				</div>
				<SyncButton system={system} />
			</div>

			<Separator />

			{/* Filters */}
			<Suspense>
				<CollectionFilters system={system} />
			</Suspense>

			{/* Game grid */}
			<CollectionGrid system={system} />
		</div>
	)
}
