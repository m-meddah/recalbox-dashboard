import type { AchievementsSummarySlide } from '@/lib/wrapped/types'
import { useTranslations } from 'next-intl'
import { SLIDE_ACCENTS } from '../accents'
import { GlassCard, SlideShell } from '../slide-shell'

type Props = { slide: AchievementsSummarySlide }

export function AchievementsSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS['achievements-summary']}>
			<GlassCard className="text-center">
				<p className="text-sm text-white/60 mb-2">{t('achievements.title')}</p>
				<p className="text-5xl font-black text-white">{slide.totalUnlocked}</p>
				<p className="text-white/60 mt-1">
					{t('achievements.points', { points: slide.totalPoints })}
				</p>
				{slide.rarestAchievement && (
					<div className="mt-4 border-t border-white/10 pt-4">
						<p className="text-xs text-white/40">
							{t('achievements.rarest', { title: slide.rarestAchievement.title })}
						</p>
					</div>
				)}
			</GlassCard>
		</SlideShell>
	)
}
