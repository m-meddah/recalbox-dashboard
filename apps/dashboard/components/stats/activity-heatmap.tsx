'use client'

import type { HeatmapCell } from '@/lib/stats/calculators'
import { formatDuration } from '@/lib/stats/formatters'
import { useTranslations } from 'next-intl'
import { useLocale } from 'next-intl'

const INTENSITY_CLASS = {
	0: 'bg-muted',
	1: 'bg-emerald-900/30',
	2: 'bg-emerald-700/50',
	3: 'bg-emerald-500/70',
	4: 'bg-emerald-400',
} as const

function getMonthLabel(week: HeatmapCell[], locale: string): string | null {
	const firstDay = week[0]?.date
	if (!firstDay) return null
	if (firstDay.getDate() <= 7) {
		return firstDay.toLocaleString(locale, { month: 'short' })
	}
	return null
}

type Props = {
	heatmap: HeatmapCell[][]
}

export function ActivityHeatmap({ heatmap }: Props) {
	const t = useTranslations('stats.heatmap')
	const locale = useLocale()

	// Day labels: Mon, Wed, Fri abbreviated — locale-aware single letters
	const dayLabels = ['', 'M', '', 'W', '', 'F', ''].map((d) =>
		d === 'M'
			? new Date(2024, 0, 1).toLocaleString(locale, { weekday: 'narrow' })
			: d === 'W'
				? new Date(2024, 0, 3).toLocaleString(locale, { weekday: 'narrow' })
				: d === 'F'
					? new Date(2024, 0, 5).toLocaleString(locale, { weekday: 'narrow' })
					: '',
	)

	const isEmpty = heatmap.flat().every((c) => c.playtimeSec === 0)

	return (
		<div className="space-y-2">
			{isEmpty && <p className="text-center text-sm text-muted-foreground py-2">{t('empty')}</p>}
			<div className="overflow-x-auto pb-2">
				<div className="flex gap-1 w-max">
				{/* Day labels column */}
				<div className="flex flex-col gap-[3px] pt-5 shrink-0">
					{dayLabels.map((label, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: positional day labels, never reorder
							key={i}
							className="h-[10px] w-3 text-[9px] text-muted-foreground leading-none flex items-center"
						>
							{label}
						</div>
					))}
				</div>

				{/* Grid */}
				<div className="flex gap-[3px]">
					{heatmap.map((week, wi) => {
						const monthLabel = getMonthLabel(week, locale)
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: positional week columns, never reorder
							<div key={wi} className="flex flex-col gap-[3px]">
								{/* Month label */}
								<div className="h-4 text-[9px] text-muted-foreground leading-none whitespace-nowrap">
									{monthLabel ?? ''}
								</div>
								{/* Cells */}
								{week.map((cell) => (
									<div
										key={cell.dateKey}
										title={
											cell.playtimeSec > 0
												? `${cell.dateKey} — ${formatDuration(cell.playtimeSec)} (${cell.sessionCount} session${cell.sessionCount > 1 ? 's' : ''})`
												: cell.dateKey
										}
										className={`h-[10px] w-[10px] rounded-[2px] ${INTENSITY_CLASS[cell.intensity]} transition-colors`}
									/>
								))}
							</div>
						)
					})}
				</div>
				</div>
			</div>

			{/* Legend */}
			<div className="flex items-center gap-1 text-[10px] text-muted-foreground justify-end">
				<span>{t('less')}</span>
				{([0, 1, 2, 3, 4] as const).map((i) => (
					<div key={i} className={`h-[10px] w-[10px] rounded-[2px] ${INTENSITY_CLASS[i]}`} />
				))}
				<span>{t('more')}</span>
			</div>
		</div>
	)
}
