'use client'

import { EmulatorOverrideButton } from '@/components/collection/emulator-override-button'
import { LaunchGameButton } from '@/components/launch-game-button'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { Game } from '@/lib/db/queries'
import { cn } from '@/lib/utils'
import { ArrowDown, ArrowUp, Star } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'

type Props = { system: string; regions: string[] }

type ApiResponse = { games: Game[]; total: number; page: number; pageSize: number }
type SortBy = 'name' | 'rating'

const PAGE_SIZE = 50

/** Box-3D / cover thumbnail, falling back to a controller glyph. */
function Cover({ game }: { game: Game }) {
	const [error, setError] = useState(false)
	const src =
		game.imagePath && !error ? `/api/media?path=${encodeURIComponent(game.imagePath)}` : null
	return (
		<div className="relative h-28 w-24 shrink-0 overflow-hidden rounded bg-muted">
			{src ? (
				<Image
					src={src}
					alt={game.name}
					fill
					sizes="96px"
					className="object-contain"
					unoptimized
					onError={() => setError(true)}
				/>
			) : (
				<div className="flex h-full items-center justify-center text-2xl text-muted-foreground">
					🎮
				</div>
			)}
		</div>
	)
}

/** Five-star rating from a 0..1 score, like the Web Manager. */
function Rating({ value }: { value: number | null }) {
	if (value === null) return <span className="text-muted-foreground">—</span>
	const stars = Math.round(value * 5)
	return (
		<span className="flex gap-0.5" title={`${Math.round(value * 100)}%`}>
			{Array.from({ length: 5 }).map((_, i) => (
				<Star
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed 5-star scale, positional
					key={i}
					className={cn(
						'size-3.5',
						i < stars ? 'fill-accent text-accent' : 'fill-muted text-muted',
					)}
				/>
			))}
		</span>
	)
}

/** Sortable column header with an asc/desc arrow when active. */
function SortHeader({
	col,
	label,
	sortBy,
	sortDir,
	onToggle,
}: {
	col: SortBy
	label: string
	sortBy: SortBy
	sortDir: 'asc' | 'desc'
	onToggle: (col: SortBy) => void
}) {
	return (
		<button
			type="button"
			onClick={() => onToggle(col)}
			className="flex items-center gap-1 font-medium hover:text-foreground"
		>
			{label}
			{sortBy === col &&
				(sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
		</button>
	)
}

export function GameTable({ system, regions }: Props) {
	const t = useTranslations('collection')
	const [data, setData] = useState<ApiResponse | null>(null)
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [favoritesOnly, setFavoritesOnly] = useState(false)
	const [region, setRegion] = useState('')
	const [sortBy, setSortBy] = useState<SortBy>('name')
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
	const [page, setPage] = useState(1)

	// Debounce the search box.
	const [debouncedSearch, setDebouncedSearch] = useState('')
	useEffect(() => {
		const id = setTimeout(() => setDebouncedSearch(search), 250)
		return () => clearTimeout(id)
	}, [search])

	// Any filter/sort change returns to page 1.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset paging when query changes
	useEffect(() => {
		setPage(1)
	}, [debouncedSearch, favoritesOnly, region, sortBy, sortDir])

	const url = useMemo(() => {
		const p = new URLSearchParams()
		p.set('system', system)
		p.set('page', String(page))
		p.set('pageSize', String(PAGE_SIZE))
		p.set('sortBy', sortBy)
		p.set('sortDir', sortDir)
		if (debouncedSearch) p.set('search', debouncedSearch)
		if (favoritesOnly) p.set('favoritesOnly', 'true')
		if (region) p.set('region', region)
		return `/api/collection?${p.toString()}`
	}, [system, page, sortBy, sortDir, debouncedSearch, favoritesOnly, region])

	useEffect(() => {
		let active = true
		setLoading(true)
		fetch(url)
			.then((r) => r.json())
			.then((d: ApiResponse) => {
				if (active) {
					setData(d)
					setLoading(false)
				}
			})
			.catch(() => active && setLoading(false))
		return () => {
			active = false
		}
	}, [url])

	const toggleSort = (col: SortBy) => {
		if (sortBy === col) {
			setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
		} else {
			setSortBy(col)
			setSortDir('asc')
		}
	}

	const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

	return (
		<div className="space-y-4">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={() => setFavoritesOnly((v) => !v)}
						className={cn(
							'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
							favoritesOnly
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-border bg-card hover:bg-muted',
						)}
					>
						<Star className={cn('size-3.5', favoritesOnly && 'fill-current')} />
						{t('filters.favorites')}
					</button>
					{regions.length > 0 && (
						<select
							value={region}
							onChange={(e) => setRegion(e.target.value)}
							className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<option value="">{t('filters.allRegions')}</option>
							{regions.map((r) => (
								<option key={r} value={r}>
									{r.toUpperCase()}
								</option>
							))}
						</select>
					)}
				</div>
				<input
					type="search"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder={t('filters.search')}
					className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
				/>
			</div>

			<Card className="overflow-hidden p-0">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
								<th className="px-3 py-3" />
								<th className="px-3 py-3">
									<SortHeader
										col="name"
										label={t('table.name')}
										sortBy={sortBy}
										sortDir={sortDir}
										onToggle={toggleSort}
									/>
								</th>
								<th className="px-3 py-3 font-medium">{t('table.publisher')}</th>
								<th className="px-3 py-3 font-medium">{t('table.developer')}</th>
								<th className="px-3 py-3 font-medium">{t('table.genre')}</th>
								<th className="px-3 py-3 text-center font-medium">{t('table.region')}</th>
								<th className="px-3 py-3 text-center font-medium">{t('table.players')}</th>
								<th className="px-3 py-3">
									<SortHeader
										col="rating"
										label={t('table.rating')}
										sortBy={sortBy}
										sortDir={sortDir}
										onToggle={toggleSort}
									/>
								</th>
								<th className="px-3 py-3" />
							</tr>
						</thead>
						<tbody>
							{data?.games.map((g, i) => (
								<tr
									key={g.id}
									className={cn(
										'border-b last:border-0 transition-colors hover:bg-muted/50',
										i % 2 === 1 && 'bg-muted/20',
									)}
								>
									<td className="py-2 pl-3">
										<Cover game={g} />
									</td>
									<td className="px-3 py-2">
										<div className="flex items-center gap-2">
											{g.favorite && (
												<Star className="size-3.5 shrink-0 fill-yellow-400 text-yellow-400" />
											)}
											<span className="font-medium" title={g.name}>
												{g.name}
											</span>
										</div>
									</td>
									<td className="px-3 py-2 text-muted-foreground">{g.publisher || '—'}</td>
									<td className="px-3 py-2 text-muted-foreground">{g.developer || '—'}</td>
									<td className="px-3 py-2 text-muted-foreground">
										{g.genre?.split('/').at(0)?.trim() || '—'}
									</td>
									<td className="px-3 py-2 text-center">
										{g.region ? (
											<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
												{g.region}
											</span>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</td>
									<td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
										{g.players || '—'}
									</td>
									<td className="px-3 py-2">
										<Rating value={g.rating} />
									</td>
									<td className="px-2 py-2 text-right">
										<div className="flex items-center justify-end">
											<EmulatorOverrideButton
												romPath={g.romPath}
												system={g.system}
												name={g.name}
												emulator={g.emulator}
												core={g.core}
											/>
											<LaunchGameButton romPath={g.romPath} system={g.system} name={g.name} />
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{!loading && data?.games.length === 0 && (
					<p className="py-12 text-center text-muted-foreground">{t('noGames')}</p>
				)}
				{loading && !data && (
					<p className="py-12 text-center text-muted-foreground">{t('table.loading')}</p>
				)}
			</Card>

			{/* Pagination */}
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{t('totalGames', { count: data?.total ?? 0 })}
				</p>
				{totalPages > 1 && (
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={page <= 1}
							onClick={() => setPage((p) => p - 1)}
						>
							{t('pagination.previous')}
						</Button>
						<span className="text-sm text-muted-foreground">
							{t('pagination.page', { page, total: totalPages })}
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= totalPages}
							onClick={() => setPage((p) => p + 1)}
						>
							{t('pagination.next')}
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
