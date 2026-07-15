'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { StorageUsage, formatBytes } from '@/components/storage-usage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatUptime } from '@/lib/stats/format-uptime'
import { Clock, MemoryStick } from 'lucide-react'
import { useTranslations } from 'next-intl'

// Serverless system panel: fed by the on-box agent's periodic snapshot via the
// SSE system:info event (no SSH). Shows what is meaningful at snapshot cadence —
// storage, RAM, uptime. CPU/temp live in SystemStatsChart above.
export function ServerlessSystemPanel() {
	const t = useTranslations('dashboard.system')
	const { mqttOnline, activity } = useRecalboxEvents()
	const info = activity.lastSystemInfo

	if (mqttOnline === false) return null
	if (!info) return null

	const storage = info.storage ?? []
	const hasRam = info.memTotalMb > 0
	const ramPercent = hasRam ? Math.round((info.memUsedMb / info.memTotalMb) * 100) : 0

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<StorageUsage storage={storage} />
			{(hasRam || info.uptimeSeconds !== undefined) && (
				<Card>
					<CardHeader>
						<CardTitle className="text-sm">{t('title')}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{hasRam && (
							<div className="space-y-1.5">
								<div className="flex items-center gap-2 text-sm">
									<MemoryStick className="size-4 text-muted-foreground" />
									<span className="font-medium">{t('ram')}</span>
									<span className="ml-auto font-semibold tabular-nums">{ramPercent}%</span>
								</div>
								<div className="h-2 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full rounded-full bg-accent transition-all"
										style={{ width: `${Math.min(100, Math.max(0, ramPercent))}%` }}
									/>
								</div>
								<div className="text-xs text-muted-foreground tabular-nums">
									{formatBytes(info.memUsedMb * 1024 ** 2)} /{' '}
									{formatBytes(info.memTotalMb * 1024 ** 2)}
								</div>
							</div>
						)}
						{info.uptimeSeconds !== undefined && (
							<div className="flex items-center gap-2 text-sm">
								<Clock className="size-4 text-muted-foreground" />
								<span className="font-medium">{t('uptime')}</span>
								<span className="ml-auto tabular-nums">{formatUptime(info.uptimeSeconds)}</span>
							</div>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	)
}
