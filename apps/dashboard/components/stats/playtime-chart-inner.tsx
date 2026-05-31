'use client'

import type { Period } from '@/lib/stats/calculators'
import { formatDuration } from '@/lib/stats/formatters'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type DataPoint = { date: string; playtimeSec: number }

function formatDateLabel(dateStr: string, period: Period, locale: string): string {
	const date = new Date(`${dateStr}T12:00:00`)
	if (period === 'week')
		return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })
	if (period === 'month') return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
	return date.toLocaleDateString(locale, { month: 'short', year: '2-digit' })
}

export default function ChartInner({
	chartData,
	period,
	locale,
}: {
	chartData: DataPoint[]
	period: Period
	locale: string
}) {
	return (
		<ResponsiveContainer width="100%" height={200}>
			<AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
				<defs>
					<linearGradient id="playtimeGradient" x1="0" y1="0" x2="0" y2="1">
						<stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
						<stop offset="95%" stopColor="#10b981" stopOpacity={0} />
					</linearGradient>
				</defs>
				<XAxis
					dataKey="date"
					tickFormatter={(v) => formatDateLabel(v as string, period, locale)}
					tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
					tickLine={false}
					axisLine={false}
					interval="preserveStartEnd"
				/>
				<YAxis
					tickFormatter={(v) => formatDuration(v as number)}
					tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
					tickLine={false}
					axisLine={false}
					width={40}
				/>
				<Tooltip
					content={({ active, payload, label }) => {
						if (!active || !payload?.[0]) return null
						return (
							<div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
								<p className="text-muted-foreground">
									{formatDateLabel(label as string, period, locale)}
								</p>
								<p className="font-semibold text-emerald-400">
									{formatDuration(payload[0].value as number)}
								</p>
							</div>
						)
					}}
				/>
				<Area
					type="monotone"
					dataKey="playtimeSec"
					stroke="#10b981"
					strokeWidth={2}
					fill="url(#playtimeGradient)"
					dot={false}
					activeDot={{ r: 3, fill: '#10b981' }}
				/>
			</AreaChart>
		</ResponsiveContainer>
	)
}
