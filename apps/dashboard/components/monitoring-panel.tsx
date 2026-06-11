'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StorageMount } from '@/lib/recalbox/storage'
import { HardDrive } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type MonitoringData = { perCore: number[]; storage: StorageMount[] }

function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Go`
	if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} Mo`
	return `${Math.round(bytes / 1024)} Ko`
}

// Solid fill for the CPU columns. Literal class names so Tailwind can scan them.
function barColor(pct: number): string {
	if (pct >= 90) return 'bg-red-500'
	if (pct >= 70) return 'bg-warning'
	return 'bg-accent'
}

// Translucent fill for the storage rows so the overlaid text stays readable in
// both light and dark themes. Literal class names for Tailwind's scanner.
function fillColor(pct: number): string {
	if (pct >= 90) return 'bg-red-500/25'
	if (pct >= 70) return 'bg-warning/30'
	return 'bg-accent/35'
}

export function MonitoringPanel() {
	const t = useTranslations('dashboard.system')
	const { mqttOnline } = useRecalboxEvents()
	const [data, setData] = useState<MonitoringData | null>(null)

	// Only poll while the Recalbox is reachable — avoids spamming SSH/HTTP
	// attempts (and server-side error logs) when it's offline.
	useEffect(() => {
		if (mqttOnline !== true) return
		let active = true
		const load = () => {
			fetch('/api/monitoring')
				.then((r) => (r.ok ? r.json() : null))
				.then((d: MonitoringData | null) => {
					if (active && d) setData(d)
				})
				.catch(() => {})
		}
		load()
		const id = setInterval(load, 5000)

		// bfcache: when the browser restores a frozen page via back/forward,
		// useEffect doesn't re-run. Force a fresh fetch on restore.
		const onPageShow = (e: PageTransitionEvent) => {
			if (e.persisted) load()
		}
		window.addEventListener('pageshow', onPageShow)

		return () => {
			active = false
			clearInterval(id)
			window.removeEventListener('pageshow', onPageShow)
		}
	}, [mqttOnline])

	if (mqttOnline === false) return null

	if (!data || (data.perCore.length === 0 && data.storage.length === 0)) return null

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{data.perCore.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-sm">{t('cores')}</CardTitle>
					</CardHeader>
					<CardContent>
						{/* Vertical bar chart, like the Web Manager monitoring page. */}
						<div className="flex h-44 items-end justify-around gap-3 pt-6">
							{data.perCore.map((pct, i) => (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: CPU cores are positional, never reorder
									key={i}
									className="flex h-full flex-1 flex-col items-center gap-2"
								>
									<div className="flex w-full flex-1 items-end justify-center">
										<div
											className={`relative flex w-full max-w-12 justify-center rounded-t transition-all ${barColor(pct)}`}
											style={{ height: `${Math.max(2, Math.min(100, pct))}%` }}
										>
											<span className="absolute -top-5 text-xs font-medium tabular-nums">
												{pct}%
											</span>
										</div>
									</div>
									<span className="text-xs text-muted-foreground">
										{t('core')} {i}
									</span>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{data.storage.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-sm">{t('storage')}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2.5">
						{data.storage.map((s) => (
							<div
								key={s.mount}
								className="relative h-14 overflow-hidden rounded-md border bg-muted/40"
							>
								<div
									className={`absolute inset-y-0 left-0 transition-all ${fillColor(s.percent)}`}
									style={{ width: `${Math.min(100, Math.max(0, s.percent))}%` }}
								/>
								<div className="relative flex h-full items-center gap-3 px-2.5">
									<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground shadow-sm">
										<HardDrive className="size-5" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2 text-sm">
											<span className="truncate font-medium">{s.label}</span>
											<span className="shrink-0 font-semibold tabular-nums">{s.percent}%</span>
										</div>
										<div className="text-xs text-muted-foreground tabular-nums">
											{formatBytes(s.usedBytes)} / {formatBytes(s.sizeBytes)}
										</div>
									</div>
								</div>
							</div>
						))}
					</CardContent>
				</Card>
			)}
		</div>
	)
}
