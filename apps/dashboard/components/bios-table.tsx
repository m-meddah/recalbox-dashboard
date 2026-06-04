'use client'

import { Card } from '@/components/ui/card'
import type { BiosEntry, BiosReport, BiosStatus } from '@/lib/recalbox/bios'
import { cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, Folder, MemoryStick, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'

type Filter = 'all' | BiosStatus

const STATUS_META: Record<
	BiosStatus,
	{ icon: typeof CheckCircle2; className: string; dot: string }
> = {
	ok: { icon: CheckCircle2, className: 'text-emerald-500', dot: 'bg-emerald-500' },
	mismatch: { icon: AlertTriangle, className: 'text-warning', dot: 'bg-warning' },
	missing: { icon: XCircle, className: 'text-red-500', dot: 'bg-red-500' },
}

/** Render a bios path "amiga/bios/kick.rom" as folder chips + filename, like the Web Manager. */
function BiosPath({ path }: { path: string }) {
	const parts = path.split('/')
	const file = parts.pop() ?? path
	return (
		<span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
			{parts.map((p, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: path segments are positional
					key={i}
					className="flex items-center gap-1 text-xs text-muted-foreground"
				>
					<Folder className="size-3.5" />
					{p}
					<span className="text-muted-foreground/50">/</span>
				</span>
			))}
			<span className="flex items-center gap-1 font-medium">
				<MemoryStick className="size-3.5 text-muted-foreground" />
				{file}
			</span>
		</span>
	)
}

export function BiosTable() {
	const t = useTranslations('bios')
	const [report, setReport] = useState<BiosReport | null>(null)
	const [error, setError] = useState(false)
	const [filter, setFilter] = useState<Filter>('all')
	const [search, setSearch] = useState('')

	useEffect(() => {
		let active = true
		setError(false)
		fetch('/api/bios')
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((d: BiosReport) => {
				if (active) setReport(d)
			})
			.catch(() => {
				if (active) setError(true)
			})
		return () => {
			active = false
		}
	}, [])

	const filtered = useMemo(() => {
		if (!report) return []
		const q = search.trim().toLowerCase()
		return report.entries.filter((e) => {
			if (filter !== 'all' && e.status !== filter) return false
			if (!q) return true
			return (
				e.systemName.toLowerCase().includes(q) ||
				e.path.toLowerCase().includes(q) ||
				e.currentMd5.toLowerCase().includes(q)
			)
		})
	}, [report, filter, search])

	if (error) {
		return <p className="py-16 text-center text-muted-foreground">{t('error')}</p>
	}

	if (!report) {
		return <p className="py-16 text-center text-muted-foreground">{t('loading')}</p>
	}

	const { summary } = report
	const chips: { key: Filter; label: string; count: number }[] = [
		{ key: 'all', label: t('filters.all'), count: summary.total },
		{ key: 'ok', label: t('filters.ok'), count: summary.ok },
		{ key: 'mismatch', label: t('filters.mismatch'), count: summary.mismatch },
		{ key: 'missing', label: t('filters.missing'), count: summary.missing },
	]

	return (
		<div className="space-y-4">
			{/* Filter chips + search */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap gap-2">
					{chips.map((c) => (
						<button
							type="button"
							key={c.key}
							onClick={() => setFilter(c.key)}
							className={cn(
								'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
								filter === c.key
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-border bg-card hover:bg-muted',
							)}
						>
							{c.key !== 'all' && (
								<span className={cn('size-2 rounded-full', STATUS_META[c.key].dot)} />
							)}
							{c.label}
							<span
								className={cn(
									'tabular-nums',
									filter === c.key ? 'opacity-80' : 'text-muted-foreground',
								)}
							>
								{c.count}
							</span>
						</button>
					))}
				</div>
				<input
					type="search"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder={t('search')}
					className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
				/>
			</div>

			<Card className="overflow-hidden p-0">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
								<th className="px-4 py-3 font-medium">{t('columns.system')}</th>
								<th className="px-4 py-3 font-medium">{t('columns.bios')}</th>
								<th className="hidden px-4 py-3 font-medium lg:table-cell">
									{t('columns.currentMd5')}
								</th>
								<th className="hidden px-4 py-3 font-medium lg:table-cell">
									{t('columns.expectedMd5')}
								</th>
								<th className="px-4 py-3 text-center font-medium">{t('columns.validity')}</th>
							</tr>
						</thead>
						<tbody>
							{filtered.map((e: BiosEntry, i) => {
								const meta = STATUS_META[e.status]
								const Icon = meta.icon
								return (
									<tr
										key={`${e.system}:${e.path}`}
										className={cn(
											'border-b last:border-0 transition-colors hover:bg-muted/50',
											i % 2 === 1 && 'bg-muted/20',
										)}
									>
										<td className="px-4 py-3 align-top">
											<span className="font-medium">{e.systemName}</span>
											{!e.mandatory && (
												<span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
													{t('optional')}
												</span>
											)}
										</td>
										<td className="px-4 py-3 align-top">
											<BiosPath path={e.path} />
										</td>
										<td className="hidden px-4 py-3 align-top font-mono text-xs lg:table-cell">
											{e.currentMd5 || <span className="text-muted-foreground">—</span>}
										</td>
										<td className="hidden px-4 py-3 align-top font-mono text-xs text-muted-foreground lg:table-cell">
											{e.expectedMd5.length ? (
												<div className="space-y-0.5">
													{e.expectedMd5.map((m, mi) => (
														// biome-ignore lint/suspicious/noArrayIndexKey: md5 list can contain duplicates
														<div key={`${m}:${mi}`}>{m}</div>
													))}
												</div>
											) : (
												'—'
											)}
										</td>
										<td className="px-4 py-3 text-center align-top">
											<Icon className={cn('inline size-5', meta.className)} aria-label={e.status} />
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
				{filtered.length === 0 && (
					<p className="py-12 text-center text-muted-foreground">{t('empty')}</p>
				)}
			</Card>
		</div>
	)
}
