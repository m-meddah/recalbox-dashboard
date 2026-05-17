import type { LongestSessionSlide } from '@/lib/wrapped/types'
import { SlideShell, GlassCard } from '../slide-shell'
import { SLIDE_ACCENTS } from '../accents'
import { useTranslations } from 'next-intl'

type Props = { slide: LongestSessionSlide }

export function LongestSessionSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS['longest-session']}>
			<GlassCard className="text-center">
				<p className="text-sm text-white/60 mb-2">{t('longestSession.title')}</p>
				<div className="text-5xl font-black text-white">
					{slide.durationHours}h {slide.durationMinutes}min
				</div>
				<p className="text-white/70 mt-3 font-semibold">{slide.gameName}</p>
				<p className="text-white/40 text-xs mt-1">{slide.dateStr}</p>
			</GlassCard>
		</SlideShell>
	)
}
