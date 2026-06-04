'use client'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

export type SystemEntry = { name: string; count: number }

/** White theme logo on a navy tile (theme logos are white, invisible on light cards). */
export function SystemLogo({ system, className }: { system: string; className?: string }) {
	const [logoError, setLogoError] = useState(false)
	return (
		<div
			className={cn(
				'flex items-center justify-center bg-linear-to-br from-[#34495e] to-[#2c3e50]',
				className,
			)}
		>
			{logoError ? (
				<span className="text-2xl">🎮</span>
			) : (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={`/api/system-logo?system=${encodeURIComponent(system)}`}
					alt={system}
					className="max-h-full max-w-full object-contain"
					onError={() => setLogoError(true)}
				/>
			)}
		</div>
	)
}

/** A single console card: white card, white theme logo on a navy tile, name + rom count. */
function SystemCard({ system }: { system: SystemEntry }) {
	const t = useTranslations('collection')
	return (
		<Link
			href={`/collection/${system.name}`}
			className="group flex flex-col overflow-hidden rounded-md border bg-card shadow-sm transition-shadow hover:shadow-md"
		>
			<SystemLogo
				system={system.name}
				className="aspect-video p-5 [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-105"
			/>
			<div className="flex items-center justify-between gap-2 px-3 py-2">
				<span className="truncate text-sm font-medium capitalize" title={system.name}>
					{system.name}
				</span>
				<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
					{t('gamesCount', { count: system.count })}
				</span>
			</div>
		</Link>
	)
}

export function SystemGrid({ systems }: { systems: SystemEntry[] }) {
	const t = useTranslations('collection')
	const [search, setSearch] = useState('')

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase()
		if (!q) return systems
		return systems.filter((s) => s.name.toLowerCase().includes(q))
	}, [systems, search])

	return (
		<div className="space-y-4">
			<input
				type="search"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				placeholder={t('filters.search')}
				className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-72"
			/>

			{filtered.length === 0 ? (
				<p className="py-16 text-center text-muted-foreground">{t('noGames')}</p>
			) : (
				<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
					{filtered.map((s) => (
						<SystemCard key={s.name} system={s} />
					))}
				</div>
			)}
		</div>
	)
}
