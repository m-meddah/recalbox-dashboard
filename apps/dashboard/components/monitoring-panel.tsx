'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StorageMount } from '@/lib/recalbox/storage'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type MonitoringData = { perCore: number[]; storage: StorageMount[] }

function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Go`
	if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} Mo`
	return `${Math.round(bytes / 1024)} Ko`
}

function usageColor(pct: number): string {
	if (pct >= 90) return 'bg-red-500'
	if (pct >= 70) return 'bg-warning'
	return 'bg-primary'
}

function Bar({ percent }: { percent: number }) {
	return (
		<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
			<div
				className={`h-full rounded-full transition-all ${usageColor(percent)}`}
				style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
			/>
		</div>
	)
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
		return () => {
			active = false
			clearInterval(id)
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
					<CardContent className="space-y-2.5">
						{data.perCore.map((pct, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: CPU cores are positional, never reorder
							<div key={i} className="flex items-center gap-3">
								<span className="w-14 shrink-0 text-xs text-muted-foreground">
									{t('core')} {i}
								</span>
								<Bar percent={pct} />
								<span className="w-9 shrink-0 text-right text-xs tabular-nums">{pct}%</span>
							</div>
						))}
					</CardContent>
				</Card>
			)}

			{data.storage.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-sm">{t('storage')}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{data.storage.map((s) => (
							<div key={s.mount} className="space-y-1">
								<div className="flex items-center justify-between gap-2 text-xs">
									<span className="truncate font-medium">{s.label}</span>
									<span className="shrink-0 text-muted-foreground tabular-nums">
										{formatBytes(s.usedBytes)} / {formatBytes(s.sizeBytes)}
									</span>
								</div>
								<Bar percent={s.percent} />
							</div>
						))}
					</CardContent>
				</Card>
			)}
		</div>
	)
}
