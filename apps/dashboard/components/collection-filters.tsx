'use client'

import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Clock, SortAsc, SortDesc, Star } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

type SortField = 'name' | 'rating' | 'lastPlayed' | 'releaseDate'

const ALLOWED_REGIONS = ['fr', 'eu', 'us', 'jp', 'world'] as const

const REGION_LABELS: Record<string, string> = {
	fr: 'FR',
	eu: 'EU',
	us: 'US',
	jp: 'JP',
	world: 'WOR',
}

export function CollectionFilters({ system }: { system?: string }) {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const [regions, setRegions] = useState<string[]>([])

	const get = (key: string) => searchParams.get(key) ?? ''

	useEffect(() => {
		const url = system ? `/api/collection/regions?system=${system}` : '/api/collection/regions'
		fetch(url)
			.then((r) => r.json())
			.then((data: { regions: string[] }) =>
				setRegions(
					data.regions
						.filter((r) => (ALLOWED_REGIONS as readonly string[]).includes(r))
						.sort(
							(a, b) =>
								(ALLOWED_REGIONS as readonly string[]).indexOf(a) -
								(ALLOWED_REGIONS as readonly string[]).indexOf(b),
						),
				),
			)
			.catch(() => {})
	}, [system])

	const update = useCallback(
		(updates: Record<string, string | null>) => {
			const params = new URLSearchParams(searchParams.toString())
			for (const [k, v] of Object.entries(updates)) {
				if (v === null || v === '') params.delete(k)
				else params.set(k, v)
			}
			params.delete('page')
			router.push(`${pathname}?${params.toString()}`)
		},
		[router, pathname, searchParams],
	)

	const toggleBool = (key: string) => update({ [key]: get(key) === 'true' ? null : 'true' })

	const toggleSort = (field: SortField) => {
		const cur = get('sortBy')
		const dir = get('sortDir') || 'asc'
		if (cur === field) update({ sortDir: dir === 'asc' ? 'desc' : 'asc' })
		else update({ sortBy: field, sortDir: 'asc' })
	}

	const sortActive = (field: SortField) =>
		get('sortBy') === field || (field === 'name' && !get('sortBy'))
	const sortDir = get('sortDir') || 'asc'

	return (
		<div className="flex flex-wrap items-center gap-2">
			{/* Search */}
			<Input
				placeholder="Rechercher…"
				className="h-8 w-48 text-sm"
				defaultValue={get('search')}
				onChange={(e) => {
					clearTimeout((window as unknown as Record<string, unknown>)._searchDebounce as number)
					;(window as unknown as Record<string, unknown>)._searchDebounce = setTimeout(
						() => update({ search: e.target.value || null }),
						300,
					) as unknown as number
				}}
			/>

			<Separator orientation="vertical" className="h-6" />

			{/* Quick filters */}
			<button
				type="button"
				onClick={() => toggleBool('favoritesOnly')}
				className={cn(
					'flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
					get('favoritesOnly') === 'true'
						? 'border-yellow-400 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30'
						: 'border-border bg-background hover:bg-accent',
				)}
			>
				<Star className="h-3 w-3" />
				Favoris
			</button>

			<button
				type="button"
				onClick={() => toggleBool('neverPlayed')}
				className={cn(
					'flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
					get('neverPlayed') === 'true'
						? 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-900/30'
						: 'border-border bg-background hover:bg-accent',
				)}
			>
				<Clock className="h-3 w-3" />
				Jamais joué
			</button>

			{/* Region filter */}
			{regions.length > 0 && (
				<>
					<Separator orientation="vertical" className="h-6" />
					{regions.map((r) => (
						<button
							key={r}
							type="button"
							onClick={() => update({ region: get('region') === r ? null : r })}
							className={cn(
								'rounded border px-2 py-1 text-[10px] font-medium uppercase transition-colors',
								get('region') === r
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border bg-background hover:bg-accent text-muted-foreground',
							)}
						>
							{REGION_LABELS[r] ?? r.toUpperCase()}
						</button>
					))}
				</>
			)}

			<Separator orientation="vertical" className="h-6" />

			{/* Sort buttons */}
			{(['name', 'rating', 'lastPlayed', 'releaseDate'] as SortField[]).map((field) => {
				const labels: Record<SortField, string> = {
					name: 'Nom',
					rating: 'Note',
					lastPlayed: 'Joué',
					releaseDate: 'Année',
				}
				const active = sortActive(field)
				return (
					<button
						key={field}
						type="button"
						onClick={() => toggleSort(field)}
						className={cn(
							'flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors',
							active
								? 'border-primary bg-primary/10 text-primary'
								: 'border-border bg-background hover:bg-accent',
						)}
					>
						{labels[field]}
						{active &&
							(sortDir === 'asc' ? (
								<SortAsc className="h-3 w-3" />
							) : (
								<SortDesc className="h-3 w-3" />
							))}
					</button>
				)
			})}
		</div>
	)
}
