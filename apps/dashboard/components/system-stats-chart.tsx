'use client'

import { useCallback, useEffect, useState } from 'react'
import {
	LineChart,
	Line,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { useRecalboxEvents } from '@/app/recalbox-events-provider'
import type { SystemInfoEvent } from '@/lib/recalbox/events'

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

/** Live system stats — driven by Recalbox/WebAPI/SystemInfo via MQTT→SSE (1 update/s). */
export function SystemStatsChart() {
	const { mqttOnline, subscribe } = useRecalboxEvents()
	const [current, setCurrent] = useState<SystemInfoEvent | null>(null)
	const [history, setHistory] = useState<ChartPoint[]>([])

	const handleEvent = useCallback((event: { type: string } & Record<string, unknown>) => {
		if (event.type !== 'system:info') return
		const e = event as unknown as SystemInfoEvent
		setCurrent(e)
		setHistory((prev) => {
			const point: ChartPoint = {
				time: new Date(e.timestamp).toLocaleTimeString('fr-FR', {
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

	// Still connecting
	if (mqttOnline === null) return <LoadingSkeleton />

	// MQTT offline
	if (mqttOnline === false) {
		return (
			<Card className="border-destructive/50">
				<CardContent className="flex items-center justify-center py-10 text-sm text-muted-foreground">
					Recalbox MQTT hors ligne — stats indisponibles
				</CardContent>
			</Card>
		)
	}

	// MQTT online but no data yet (first system:info not received)
	if (!current) return <LoadingSkeleton />

	const ramPercent =
		current.memTotalMb > 0 ? Math.round((current.memUsedMb / current.memTotalMb) * 100) : null

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-3 gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							CPU Temperature
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className={`text-3xl font-bold tabular-nums ${tempColorClass(current.tempCelsius)}`}>
							{current.tempCelsius.toFixed(1)}°C
						</p>
						<Badge
							variant="outline"
							className={`mt-1 text-xs ${tempColorClass(current.tempCelsius)}`}
						>
							{current.tempCelsius < 60 ? 'Normal' : current.tempCelsius < 75 ? 'Chaud' : 'Critique'}
						</Badge>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">RAM</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold tabular-nums">
							{current.memUsedMb}
							<span className="text-base font-normal text-muted-foreground">
								{' '}/ {current.memTotalMb} MB
							</span>
						</p>
						{ramPercent != null && (
							<div className="mt-2">
								<Progress value={ramPercent} className="h-2" />
								<p className="text-xs text-muted-foreground mt-1">{ramPercent}% utilisé</p>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">CPU</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold tabular-nums">{current.cpuPercent.toFixed(1)}%</p>
						<div className="mt-2">
							<Progress value={current.cpuPercent} className="h-2" />
						</div>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						CPU Temperature — {MAX_HISTORY} dernières secondes
					</CardTitle>
				</CardHeader>
				<CardContent>
					{history.length < 2 ? (
						<p className="text-sm text-muted-foreground text-center py-10">
							En attente de données…
						</p>
					) : (
						<ResponsiveContainer width="100%" height={200}>
							<LineChart data={history} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
								<XAxis
									dataKey="time"
									tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
									tickLine={false}
									interval="preserveStartEnd"
								/>
								<YAxis
									domain={['auto', 'auto']}
									unit="°C"
									tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
									tickLine={false}
									axisLine={false}
									width={42}
								/>
								<Tooltip
									formatter={(value: number) => [`${value.toFixed(1)}°C`, 'CPU Temp']}
									contentStyle={{
										background: 'hsl(var(--card))',
										border: '1px solid hsl(var(--border))',
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
