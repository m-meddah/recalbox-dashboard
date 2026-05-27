import type { BusiestDaySlide } from '@/lib/wrapped/types'
import { useTranslations } from 'next-intl'
import { SLIDE_ACCENTS } from '../accents'
import { GlassCard, SlideShell } from '../slide-shell'

type Props = { slide: BusiestDaySlide }

export function BusiestDaySlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS['busiest-day']}>
			<GlassCard className="text-center">
				<p className="text-sm text-white/60 mb-2">{t('busiestDay.title')}</p>
				<p className="text-3xl font-black text-white">{slide.dateStr}</p>
				<p className="text-white/70 mt-3 text-2xl font-bold">
					{slide.totalHours > 0
						? `${slide.totalHours}h${slide.totalMinutes > 0 ? ` ${slide.totalMinutes}m` : ''}`
						: `${slide.totalMinutes}m`}
				</p>
				<p className="text-white/40 text-xs mt-1">
					{t('busiestDay.sessions', { sessions: slide.sessionCount })}
				</p>
			</GlassCard>
		</SlideShell>
	)
}
