'use client'

import type { TotalTimeSlide } from '@/lib/wrapped/types'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { SLIDE_ACCENTS } from '../accents'
import { GlassCard, SlideShell } from '../slide-shell'

type Props = { slide: TotalTimeSlide }

function AnimatedValue({ target }: { target: number }) {
	const safeTarget = Number.isFinite(target) ? target : 0
	const [current, setCurrent] = useState(0)
	useEffect(() => {
		const duration = 2000
		const steps = 60
		let i = 0
		const id = setInterval(() => {
			i++
			setCurrent(Math.min(safeTarget, Math.round((safeTarget / steps) * i)))
			if (i >= steps) clearInterval(id)
		}, duration / steps)
		return () => clearInterval(id)
	}, [safeTarget])
	return <span className="text-8xl font-black text-white tabular-nums">{current}</span>
}

export function TotalTimeSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	const hours = slide.totalHours ?? 0
	const minutes = slide.totalMinutes ?? 0
	const showHours = hours > 0
	return (
		<SlideShell accent={SLIDE_ACCENTS['total-time']}>
			<GlassCard className="flex flex-col items-center gap-3 text-center">
				<p className="text-sm text-white/60">{t('totalTime.headline', { hours: '' }).trim()}</p>
				<div className="flex items-end gap-1">
					{showHours ? (
						<>
							<AnimatedValue target={hours} />
							<span className="text-3xl font-bold text-white/80 mb-2">h</span>
							{minutes > 0 && (
								<span className="text-3xl font-bold text-white/60 mb-2 ml-1">{minutes}m</span>
							)}
						</>
					) : (
						<>
							<AnimatedValue target={minutes} />
							<span className="text-3xl font-bold text-white/80 mb-2">m</span>
						</>
					)}
				</div>
				<p className="text-white/50 text-sm">
					{t('totalTime.subheadline', { sessions: slide.totalSessions })}
				</p>
			</GlassCard>
			<p className="text-white/40 text-xs text-center max-w-xs">
				{t('totalTime.comparison', { movies: slide.comparisonMovies })}
			</p>
		</SlideShell>
	)
}
