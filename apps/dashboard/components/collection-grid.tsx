'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { GameCard } from './game-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import type { Game } from '@/lib/db/queries'

type Props = {
	system?: string
}

type ApiResponse = {
	games: Game[]
	total: number
	page: number
	pageSize: number
}

function GridSkeleton() {
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
			{Array.from({ length: 18 }).map((_, i) => (
				<div key={i} className="space-y-2">
					<Skeleton className="aspect-[3/4] w-full rounded-md" />
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-3 w-1/2" />
				</div>
			))}
		</div>
	)
}

function CollectionGridInner({ system }: Props) {
	const searchParams = useSearchParams()
	const [data, setData] = useState<ApiResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [page, setPage] = useState(1)
	const PAGE_SIZE = 60

	const buildUrl = useCallback(
		(p: number) => {
			const params = new URLSearchParams(searchParams.toString())
			params.set('page', String(p))
			params.set('pageSize', String(PAGE_SIZE))
			if (system) params.set('system', system)
			return `/api/collection?${params.toString()}`
		},
		[searchParams, system],
	)

	useEffect(() => {
		setPage(1)
	}, [searchParams])

	useEffect(() => {
		setLoading(true)
		fetch(buildUrl(page))
			.then((r) => r.json())
			.then((d: ApiResponse) => setData(d))
			.finally(() => setLoading(false))
	}, [buildUrl, page])

	if (loading) return <GridSkeleton />
	if (!data || data.games.length === 0) {
		return (
			<div className="py-16 text-center text-muted-foreground">
				Aucun jeu trouvé. Lance une synchronisation depuis la Recalbox.
			</div>
		)
	}

	const totalPages = Math.ceil(data.total / PAGE_SIZE)

	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				{data.total.toLocaleString('fr-FR')} jeu{data.total > 1 ? 'x' : ''}
			</p>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
				{data.games.map((game) => (
					<GameCard key={game.id} game={game} />
				))}
			</div>

			{totalPages > 1 && (
				<div className="flex items-center justify-center gap-2 pt-4">
					<Button
						variant="outline"
						size="sm"
						disabled={page <= 1}
						onClick={() => setPage((p) => p - 1)}
					>
						Précédent
					</Button>
					<span className="text-sm text-muted-foreground">
						{page} / {totalPages}
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={page >= totalPages}
						onClick={() => setPage((p) => p + 1)}
					>
						Suivant
					</Button>
				</div>
			)}
		</div>
	)
}

export function CollectionGrid(props: Props) {
	return (
		<Suspense fallback={<GridSkeleton />}>
			<CollectionGridInner {...props} />
		</Suspense>
	)
}
