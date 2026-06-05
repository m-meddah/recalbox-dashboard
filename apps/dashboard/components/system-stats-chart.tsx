'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { SystemInfoEvent } from '@/lib/recalbox/events'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'

type ChartPoint = { time: string; temp: number }

const MAX_HISTORY = 60

function tempColorClass(temp: number): string {
	if (temp < 60) return 'text-green-500'
	if (temp < 75) return 'text-orange-500'
	return 'text-red-500'
}

function LoadingSkeleton() {
	return (
		<div className="space-y-4 animate-pulse">
			<div className="grid grid-cols-3 gap-4">
				{[0, 1, 2].map((i) => (
					<Card key={i}>
						<CardHeader>
							<div className="h-4 bg-muted rounded w-2/3" />
						</CardHeader>
						<CardContent>
							<div className="h-8 bg-muted rounded w-1/2 mt-1" />
						</CardContent>
					</Card>
				))}
			</div>
			<Card>
				<CardHeader>
					<div className="h-4 bg-muted rounded w-1/3" />
				</CardHeader>
				<CardContent>
					<div className="h-48 bg-muted rounded" />
				</CardContent>
			</Card>
		</div>
	)
}

const ChartInner = dynamic(() => import('./system-stats-chart-inner'), { ssr: false })

export function SystemStatsChart() {
	const t = useTranslations('dashboard.system')
	const { mqttOnline, subscribe, activity } = useRecalboxEvents()
	const [current, setCurrent] = useState<SystemInfoEvent | null>(() => activity.lastSystemInfo)
	const [history, setHistory] = useState<ChartPoint[]>(() => {
		if (!activity.lastSystemInfo) return []
		return [
			{
				time: new Date(activity.lastSystemInfo.timestamp).toLocaleTimeString(undefined, {
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
				}),
				temp: activity.lastSystemInfo.tempCelsius,
			},
		]
	})

	const handleEvent = useCallback((event: { type: string } & Record<string, unknown>) => {
		if (event.type !== 'system:info') return
		const e = event as unknown as SystemInfoEvent
		setCurrent(e)
		setHistory((prev) => {
			const point: ChartPoint = {
				time: new Date(e.timestamp).toLocaleTimeString(undefined, {
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
				}),
				temp: e.tempCelsius,
			}
			const next = [...prev, point]
			return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
		})
	}, [])

	useEffect(() => {
		return subscribe(handleEvent)
	}, [subscribe, handleEvent])

	if (mqttOnline === null) return <LoadingSkeleton />

	if (mqttOnline === false) {
		return (
			<Card className="border-destructive/50">
				<CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
					{t('offline')}
				</CardContent>
			</Card>
		)
	}

	if (!current) return <LoadingSkeleton />

	return <ChartInner current={current} history={history} />
}
