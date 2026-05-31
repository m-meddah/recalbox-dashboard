'use client'

import { useRouter } from '@/i18n/navigation'
import { formatDuration } from '@/lib/stats/formatters'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'

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

type Props = {
	data: SystemEntry[]
}

const ChartInner = dynamic(() => import('./system-distribution-inner'), { ssr: false })

export function SystemDistribution({ data }: Props) {
	const t = useTranslations('stats.systemDistribution')
	const router = useRouter()

	if (data.length === 0) {
		return (
			<div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
				{t('empty')}
			</div>
		)
	}

	const top6 = data.slice(0, 6)
	const others = data.slice(6)
	const othersLabel = t('others')
	const chartData =
		others.length > 0
			? [
					...top6,
					{
						system: othersLabel,
						playtimeSec: others.reduce((s, r) => s + r.playtimeSec, 0),
						sessionCount: others.reduce((s, r) => s + r.sessionCount, 0),
						percentage: others.reduce((s, r) => s + r.percentage, 0),
					},
				]
			: top6

	return <ChartInner chartData={chartData} othersLabel={othersLabel} router={router} />
}
