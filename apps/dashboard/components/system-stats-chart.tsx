'use client'

import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { SystemInfoEvent } from '@/lib/recalbox/events'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'

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

export function SystemStatsChart() {
	const t = useTranslations('dashboard.system')
	const { mqttOnline, subscribe } = useRecalboxEvents()
	const [current, setCurrent] = useState<SystemInfoEvent | null>(null)
	const [history, setHistory] = useState<ChartPoint[]>([])

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

	const ramPercent =
		current.memTotalMb > 0 ? Math.round((current.memUsedMb / current.memTotalMb) * 100) : null

	const tempLabel =
		current.tempCelsius < 60
			? t('tempNormal')
			: current.tempCelsius < 75
				? t('tempWarm')
				: t('tempCritical')

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-3 gap-2 sm:gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
							{t('cpuTemp')}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p
							className={`text-xl sm:text-3xl font-bold tabular-nums ${tempColorClass(current.tempCelsius)}`}
						>
							{current.tempCelsius.toFixed(1)}°C
						</p>
						<Badge
							variant="outline"
							className={`mt-1 text-[10px] sm:text-xs ${tempColorClass(current.tempCelsius)}`}
						>
							{tempLabel}
						</Badge>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
							{t('cpu')}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-xl sm:text-3xl font-bold tabular-nums">
							{current.cpuPercent.toFixed(1)}%
						</p>
						<div className="mt-2">
							<Progress value={current.cpuPercent} className="h-2" />
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
							RAM
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-xl sm:text-3xl font-bold tabular-nums">
							{current.memUsedMb}
							<span className="text-xs sm:text-base font-normal text-muted-foreground">
								{' '}
								/ {current.memTotalMb}
								<span className="hidden sm:inline"> MB</span>
							</span>
						</p>
						{ramPercent != null && (
							<div className="mt-2">
								<Progress value={ramPercent} className="h-2" />
								<p className="text-xs text-muted-foreground mt-1">
									{t('ramUsed', { percent: ramPercent })}
								</p>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						{t('cpuTempHistory', { seconds: MAX_HISTORY })}
					</CardTitle>
				</CardHeader>
				<CardContent>
					{history.length < 2 ? (
						<p className="text-sm text-muted-foreground text-center py-10">{t('waitingData')}</p>
					) : (
						<ResponsiveContainer width="100%" height={200}>
							<LineChart data={history} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
								<XAxis
									dataKey="time"
									tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
									tickLine={false}
									interval="preserveStartEnd"
								/>
								<YAxis
									domain={['auto', 'auto']}
									unit="°C"
									tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
									tickLine={false}
									axisLine={false}
									width={42}
								/>
								<Tooltip
									formatter={(value: number) => [`${value.toFixed(1)}°C`, 'CPU Temp']}
									contentStyle={{
										background: 'var(--card)',
										border: '1px solid var(--border)',
										borderRadius: '6px',
										fontSize: '12px',
									}}
								/>
								<Line
									type="monotone"
									dataKey="temp"
									stroke="#f97316"
									strokeWidth={2}
									dot={false}
									activeDot={{ r: 4 }}
									isAnimationActive={false}
								/>
							</LineChart>
						</ResponsiveContainer>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
