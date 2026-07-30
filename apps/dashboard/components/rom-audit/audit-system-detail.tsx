'use client'

import { DeepVerifyButton } from '@/components/rom-audit/deep-verify-button'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type Tab = 'missing' | 'owned' | 'unknown'

type MissingGame = {
	title: string
	regions: string[]
	categories: string[]
	entries: { game: { name: string }; rom: { name: string; size: number; crc?: string } }[]
	missingDiscs: number[]
}

type RomFile = {
	entryKey: string
	path: string
	innerName: string | null
	kind: string
	matchLevel: string
	datEntryName: string | null
	mount: string
}

type Payload = {
	games?: MissingGame[]
	files?: RomFile[]
	total?: number
	reason?: string
}

const LEVEL_BADGE: Record<string, string> = {
	verified: '✅',
	serial: '◆',
	named: '~',
	unknown: '?',
}

export function AuditSystemDetail({
	recalboxId,
	system,
	regions,
}: {
	recalboxId: string
	system: string
	regions: string[]
}) {
	const t = useTranslations('romAudit')
	// Missing games first: it is the actionable list, so it is the default tab.
	const [tab, setTab] = useState<Tab>('missing')
	const [region, setRegion] = useState<string>('')
	const [data, setData] = useState<Payload | null>(null)
	const [loading, setLoading] = useState(true)
	const [expanded, setExpanded] = useState<string | null>(null)
	// Which deep-verify binaries the host actually has. Empty in serverless mode,
	// so the button never appears where it could not run.
	const [tools, setTools] = useState<Record<string, boolean>>({})

	useEffect(() => {
		let cancelled = false
		fetch(`/api/rom-audit/verify?recalboxId=${encodeURIComponent(recalboxId)}`)
			.then((res) => (res.ok ? res.json() : { tools: [] }))
			.then((body: { tools?: { tool: string; available: boolean }[] }) => {
				if (cancelled) return
				const map: Record<string, boolean> = {}
				for (const t of body.tools ?? []) map[t.tool] = t.available
				setTools(map)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [recalboxId])

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		const query = new URLSearchParams({ recalboxId, tab })
		if (region) query.set('region', region)
		fetch(`/api/rom-audit/systems/${encodeURIComponent(system)}?${query.toString()}`)
			.then((res) => (res.ok ? res.json() : { reason: 'not_audited' }))
			.then((body) => {
				if (!cancelled) setData(body)
			})
			.catch(() => {
				if (!cancelled) setData({ reason: 'error' })
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [system, tab, region, recalboxId])

	const exportQuery = new URLSearchParams({ recalboxId, system, format: 'csv' })
	if (region) exportQuery.set('region', region)

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
					<TabsList>
						<TabsTrigger value="missing">{t('tabs.missing')}</TabsTrigger>
						<TabsTrigger value="owned">{t('tabs.owned')}</TabsTrigger>
						<TabsTrigger value="unknown">{t('tabs.unknown')}</TabsTrigger>
					</TabsList>
				</Tabs>

				<div className="flex items-center gap-2">
					{tab === 'missing' && regions.length > 0 && (
						<select
							value={region}
							onChange={(e) => setRegion(e.target.value)}
							className="h-8 rounded-md border bg-background px-2 text-sm"
						>
							<option value="">{t('filters.allRegions')}</option>
							{regions.map((r) => (
								<option key={r} value={r}>
									{r}
								</option>
							))}
						</select>
					)}
					{tab === 'missing' && (
						<a
							href={`/api/rom-audit/export?${exportQuery.toString()}`}
							className={buttonVariants({ variant: 'outline', size: 'sm' })}
						>
							<Download className="mr-2 size-4" />
							{t('export.csv')}
						</a>
					)}
				</div>
			</div>

			{loading && <p className="text-muted-foreground text-sm">{t('detail.loading')}</p>}

			{!loading && data?.reason === 'no-catalog' && (
				<p className="text-muted-foreground text-sm">{t('detail.noCatalog')}</p>
			)}
			{!loading && data?.reason === 'aggregates-only' && (
				<p className="text-muted-foreground text-sm">{t('detail.aggregatesOnly')}</p>
			)}
			{!loading && data?.reason === 'catalog-unavailable' && (
				<p className="text-muted-foreground text-sm">{t('detail.catalogUnavailable')}</p>
			)}

			{!loading && tab === 'missing' && data?.games && (
				<div className="space-y-1">
					<p className="text-muted-foreground text-sm">
						{t('detail.missingCount', { count: data.total ?? data.games.length })}
					</p>
					<ul className="divide-y rounded-md border">
						{data.games.map((game) => (
							<li key={game.title} className="px-3 py-2">
								<button
									type="button"
									onClick={() => setExpanded(expanded === game.title ? null : game.title)}
									className="flex w-full items-center justify-between gap-2 text-left"
								>
									<span className="font-medium text-sm">{game.title}</span>
									<span className="flex items-center gap-1">
										{game.regions.map((r) => (
											<Badge key={r} variant="outline" className="text-[10px]">
												{r}
											</Badge>
										))}
									</span>
								</button>

								{expanded === game.title && (
									<ul className="mt-2 space-y-1 border-l pl-3 text-muted-foreground text-xs">
										{game.entries.map((entry) => (
											<li key={entry.rom.name} className="flex justify-between gap-2">
												<span className="truncate">{entry.rom.name}</span>
												<span className="tabular-nums">{entry.rom.crc ?? '—'}</span>
											</li>
										))}
									</ul>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{!loading && tab !== 'missing' && data?.files && (
				<ul className="divide-y rounded-md border">
					{data.files.map((file) => (
						<li key={file.entryKey} className="flex items-center gap-2 px-3 py-2 text-sm">
							<span>{LEVEL_BADGE[file.matchLevel] ?? '?'}</span>
							<span className="min-w-0 flex-1 truncate">{file.innerName ?? file.path}</span>
							<DeepVerifyButton
								recalboxId={recalboxId}
								entryKey={file.entryKey}
								kind={file.kind}
								toolAvailable={file.kind === 'chd' ? !!tools.chdman : !!tools['dolphin-tool']}
							/>
							<span className="truncate text-muted-foreground text-xs">{file.mount}</span>
						</li>
					))}
				</ul>
			)}

			{!loading && !data?.reason && (data?.games?.length === 0 || data?.files?.length === 0) && (
				<p className="text-muted-foreground text-sm">{t('detail.empty')}</p>
			)}
		</div>
	)
}
