'use client'

import type { StreakSlide } from '@/lib/wrapped/types'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { SLIDE_ACCENTS } from '../accents'
import { GlassCard, SlideShell } from '../slide-shell'

type Props = { slide: StreakSlide }

export function StreakSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	const activeDaySet = new Set(slide.activeDays)

	const firstDay = slide.activeDays[0]
	const year = firstDay ? Number.parseInt(firstDay.slice(0, 4)) : new Date().getFullYear()
	const days: string[] = []
	for (let i = 0; i < 365; i++) {
		const d = new Date(Date.UTC(year, 0, 1 + i))
		days.push(d.toISOString().slice(0, 10))
	}

	return (
		<SlideShell accent={SLIDE_ACCENTS.streak}>
			<GlassCard className="text-center">
				<p className="text-sm text-white/60 mb-2">{t('streak.title')}</p>
				<p className="text-5xl font-black text-white">
					{t('streak.headline', { days: slide.longestStreak })}
				</p>
			</GlassCard>
			<div className="flex flex-wrap gap-0.5 max-w-sm justify-center">
				{days.map((day, i) => (
					<motion.div
						key={day}
						initial={{ opacity: 0, scale: 0.5 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ delay: Math.min(i * 0.003, 0.5), duration: 0.15 }}
						className={`h-1.5 w-1.5 rounded-sm ${activeDaySet.has(day) ? 'bg-amber-400' : 'bg-white/10'}`}
					/>
				))}
			</div>
		</SlideShell>
	)
}
