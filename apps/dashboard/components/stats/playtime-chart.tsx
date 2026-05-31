'use client'

import type { Period } from '@/lib/stats/calculators'
import { formatDuration } from '@/lib/stats/formatters'
import { useLocale, useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'

type DataPoint = { date: string; playtimeSec: number }

function groupByWeek(data: DataPoint[]): DataPoint[] {
	const map = new Map<string, number>()
	for (const d of data) {
		const date = new Date(`${d.date}T12:00:00`)
		const weekStart = new Date(date)
		weekStart.setDate(date.getDate() - date.getDay())
		const key = weekStart.toISOString().slice(0, 10)
		map.set(key, (map.get(key) ?? 0) + d.playtimeSec)
	}
	return [...map.entries()]
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([date, playtimeSec]) => ({ date, playtimeSec }))
}

function formatDateLabel(dateStr: string, period: Period, locale: string): string {
	const date = new Date(`${dateStr}T12:00:00`)
	if (period === 'week')
		return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })
	if (period === 'month') return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
	return date.toLocaleDateString(locale, { month: 'short', year: '2-digit' })
}

type Props = {
	data: DataPoint[]
	period: Period
}

const ChartInner = dynamic(() => import('./playtime-chart-inner'), { ssr: false })

export function PlaytimeChart({ data, period }: Props) {
	const t = useTranslations('stats.playtimeChart')
	const locale = useLocale()
	const chartData = period === 'year' || period === 'all' ? groupByWeek(data) : data

	if (chartData.length === 0) {
		return (
			<div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
				{t('empty')}
			</div>
		)
	}

	return <ChartInner chartData={chartData} period={period} locale={locale} />
}
