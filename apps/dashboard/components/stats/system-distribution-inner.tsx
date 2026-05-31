'use client'

import { formatDuration } from '@/lib/stats/formatters'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { useRouter } from '@/i18n/navigation'

const COLORS = [
	'#10b981', // emerald
	'#3b82f6', // blue
	'#f59e0b', // amber
	'#ef4444', // red
	'#8b5cf6', // violet
	'#06b6d4', // cyan
	'#f97316', // orange
]

type SystemEntry = {
	system: string
	playtimeSec: number
	sessionCount: number
	percentage: number
}

export default function ChartInner({
	chartData,
	othersLabel,
	router,
}: {
	chartData: SystemEntry[]
	othersLabel: string
	router: ReturnType<typeof useRouter>
}) {
	return (
		<ResponsiveContainer width="100%" height={220}>
			<PieChart>
				<Pie
					data={chartData}
					cx="50%"
					cy="45%"
					innerRadius="55%"
					outerRadius="80%"
					dataKey="playtimeSec"
					nameKey="system"
					onClick={(entry) => {
						if (entry.system !== othersLabel) {
							router.push(`/collection/${entry.system}`)
						}
					}}
					className="cursor-pointer"
				>
					{chartData.map((entry, i) => (
						<Cell key={entry.system} fill={COLORS[i % COLORS.length]} />
					))}
				</Pie>
				<Tooltip
					content={({ active, payload }) => {
						if (!active || !payload?.[0]) return null
						const d = payload[0].payload as SystemEntry
						return (
							<div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
								<p className="font-medium capitalize">{d.system}</p>
								<p className="text-muted-foreground">{formatDuration(d.playtimeSec)}</p>
								<p className="text-muted-foreground">{d.percentage}%</p>
							</div>
						)
					}}
				/>
				<Legend
					formatter={(value) => <span className="text-xs capitalize text-foreground">{value}</span>}
					iconSize={10}
					iconType="circle"
				/>
			</PieChart>
		</ResponsiveContainer>
	)
}
