import { Skeleton } from '@/components/ui/skeleton'

/**
 * Suspense boundary shared by every route under [locale].
 *
 * Two reasons it exists. For the user: navigation now paints immediately instead of
 * sitting on the previous page until the server finishes an aggregate query. For the
 * bill: a route WITHOUT a boundary is prefetched by rendering the whole thing on the
 * server, so the sidebar's visible links used to cost ~10 speculative renders per page
 * view. A child segment can override this with its own loading.tsx when a closer-fitting
 * skeleton is worth the code.
 */
export default function Loading() {
	return (
		<div className="container mx-auto max-w-6xl space-y-8 px-4 py-8">
			<Skeleton className="h-8 w-48" />

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
			</div>

			<Skeleton className="h-40" />

			<div className="grid gap-6 lg:grid-cols-2">
				<Skeleton className="h-64" />
				<Skeleton className="h-64" />
			</div>
		</div>
	)
}
