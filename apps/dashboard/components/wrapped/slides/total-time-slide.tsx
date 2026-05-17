'use client'

import { useEffect, useState } from 'react'
import type { TotalTimeSlide } from '@/lib/wrapped/types'
import { SlideShell, GlassCard } from '../slide-shell'
import { SLIDE_ACCENTS } from '../accents'
import { useTranslations } from 'next-intl'

type Props = { slide: TotalTimeSlide }

function AnimatedHours({ target }: { target: number }) {
	const [current, setCurrent] = useState(0)
	useEffect(() => {
		const duration = 2000
		const steps = 60
		let i = 0
		const id = setInterval(() => {
			i++
			setCurrent(Math.min(target, Math.round((target / steps) * i)))
			if (i >= steps) clearInterval(id)
		}, duration / steps)
		return () => clearInterval(id)
	}, [target])
	return <span className="text-8xl font-black text-white tabular-nums">{current}</span>
}

export function TotalTimeSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS['total-time']}>
			<GlassCard className="flex flex-col items-center gap-3 text-center">
				<p className="text-sm text-white/60">{t('totalTime.headline', { hours: '' }).trim()}</p>
				<div className="flex items-end gap-1">
					<AnimatedHours target={slide.totalHours} />
					<span className="text-3xl font-bold text-white/80 mb-2">h</span>
				</div>
				<p className="text-white/50 text-sm">{t('totalTime.subheadline', { sessions: slide.totalSessions })}</p>
			</GlassCard>
			<p className="text-white/40 text-xs text-center max-w-xs">
				{t('totalTime.comparison', { movies: slide.comparisonMovies })}
			</p>
		</SlideShell>
	)
}
