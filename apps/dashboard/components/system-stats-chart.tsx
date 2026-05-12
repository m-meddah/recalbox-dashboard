'use client'

import { useEffect, useState, useEffectEvent } from 'react'
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type DbSnapshot = {
	id: number
	capturedAt: string
	cpuPercent: number | null
	memUsedMb: number | null
	memTotalMb: number | null
	tempCelsius: number | null
	uptimeSeconds: number | null
}

type CurrentStats = {
	cpuTemp: number | null
	cpuUsage: number | null
	ramUsedMb: number | null
	ramTotalMb: number | null
	uptimeSec: number | null
	takenAt: string
}

type StatsResponse = {
	current: CurrentStats
	history?: DbSnapshot[]
}

const POLL_INTERVAL_MS = 5000

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400)
	const h = Math.floor((seconds % 86400) / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const parts: string[] = []
	if (d > 0) parts.push(`${d}d`)
	if (h > 0) parts.push(`${h}h`)
	if (m > 0) parts.push(`${m}m`)
	return parts.length > 0 ? parts.join(' ') : '<1m'
}

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

/** Live system stats widget — polls /api/system-stats every 5 s, pauses when tab is hidden. */
export function SystemStatsChart() {
	const [data, setData] = useState<StatsResponse | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	const fetchStats = useEffectEvent(async () => {
		try {
			const res = await fetch('/api/system-stats?history=60')
			if (!res.ok) throw new Error(`Recalbox unreachable (HTTP ${res.status})`)
			const json = (await res.json()) as StatsResponse
			setData(json)
			setError(null)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Recalbox unreachable')
		} finally {
			setLoading(false)
		}
	})

	useEffect(() => {
		fetchStats()

		const onVisibilityChange = () => {
			if (!document.hidden) fetchStats()
		}
		document.addEventListener('visibilitychange', onVisibilityChange)

		const intervalId = setInterval(() => {
			if (!document.hidden) fetchStats()
		}, POLL_INTERVAL_MS)

		return () => {
			clearInterval(intervalId)
			document.removeEventListener('visibilitychange', onVisibilityChange)
		}
	}, [])

	if (loading) return <LoadingSkeleton />

	if (error && !data) {
		return (
			<Alert variant="destructive">
				<AlertTitle>Recalbox injoignable</AlertTitle>
				<AlertDescription className="mt-2 flex items-center gap-4">
					{error}
					<Button size="sm" variant="outline" onClick={() => fetchStats()}>
						Réessayer
					</Button>
				</AlertDescription>
			</Alert>
		)
	}

	const current = data?.current
	const history = data?.history ?? []

	const chartData = history.map((snap) => ({
		time: new Date(snap.capturedAt).toLocaleTimeString('fr-FR', {
			hour: '2-digit',
			minute: '2-digit',
		}),
		temp: snap.tempCelsius,
	}))

	const ramPercent =
		current?.ramUsedMb != null && current.ramTotalMb
			? Math.round((current.ramUsedMb / current.ramTotalMb) * 100)
			: null

	return (
		<div className="space-y-4">
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			<div className="grid grid-cols-3 gap-4">
				{/* CPU Temperature */}
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							CPU Temperature
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p
							className={`text-3xl font-bold tabular-nums ${
								current?.cpuTemp != null
									? tempColorClass(current.cpuTemp)
									: 'text-muted-foreground'
							}`}
						>
							{current?.cpuTemp != null ? `${current.cpuTemp.toFixed(1)}°C` : '—'}
						</p>
						{current?.cpuTemp != null && (
							<Badge
								variant="outline"
								className={`mt-1 text-xs ${tempColorClass(current.cpuTemp)}`}
							>
								{current.cpuTemp < 60
									? 'Normal'
									: current.cpuTemp < 75
										? 'Chaud'
										: 'Critique'}
							</Badge>
						)}
					</CardContent>
				</Card>

				{/* RAM */}
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">RAM</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold tabular-nums">
							{current?.ramUsedMb != null ? `${current.ramUsedMb}` : '—'}
							{current?.ramTotalMb != null && (
								<span className="text-base font-normal text-muted-foreground">
									{' '}
									/ {current.ramTotalMb} MB
								</span>
							)}
						</p>
						{ramPercent != null && (
							<div className="mt-2">
								<Progress value={ramPercent} className="h-2" />
								<p className="text-xs text-muted-foreground mt-1">{ramPercent}% utilisé</p>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Uptime */}
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">Uptime</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold tabular-nums">
							{current?.uptimeSec != null ? formatUptime(current.uptimeSec) : '—'}
						</p>
						{current?.cpuUsage != null && (
							<p className="text-xs text-muted-foreground mt-1">
								CPU {current.cpuUsage.toFixed(1)}%
							</p>
						)}
					</CardContent>
				</Card>
			</div>

			{/* CPU Temperature chart */}
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						CPU Temperature — 60 dernières minutes
					</CardTitle>
				</CardHeader>
				<CardContent>
					{chartData.length === 0 ? (
						<p className="text-sm text-muted-foreground text-center py-10">
							En attente de données historiques…
						</p>
					) : (
						<ResponsiveContainer width="100%" height={200}>
							<LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
								<XAxis
									dataKey="time"
									tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
									tickLine={false}
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
								/>
							</LineChart>
						</ResponsiveContainer>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
