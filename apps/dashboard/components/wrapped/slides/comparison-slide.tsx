import type { ComparisonSlide } from '@/lib/wrapped/types'
import { useTranslations } from 'next-intl'
import { SLIDE_ACCENTS } from '../accents'
import { GlassCard, SlideShell } from '../slide-shell'

type Props = { slide: ComparisonSlide }

export function ComparisonSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS['comparison-vs-others']}>
			<GlassCard className="text-center">
				<p className="text-sm text-white/60 mb-2">{t('comparison.title')}</p>
				<p className="text-5xl font-black text-white">
					{t('comparison.headline', { percent: slide.percentile })}
				</p>
				<div className="mt-4 flex justify-center gap-6">
					<div>
						<p className="text-xl font-bold text-white">
							{slide.totalHours > 0
								? `${slide.totalHours}h${slide.totalMinutes > 0 ? ` ${slide.totalMinutes}m` : ''}`
								: `${slide.totalMinutes}m`}
						</p>
						<p className="text-xs text-white/40">
							{t('comparison.yourHours', { hours: '' }).trim()}
						</p>
					</div>
					<div>
						<p className="text-xl font-bold text-white/50">{slide.averageHours}h</p>
						<p className="text-xs text-white/40">
							{t('comparison.avgHours', { hours: '' }).trim()}
						</p>
					</div>
				</div>
				<p className="text-[10px] text-white/25 mt-3">{t('comparison.disclaimer')}</p>
			</GlassCard>
		</SlideShell>
	)
}
