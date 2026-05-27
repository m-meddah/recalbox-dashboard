import type { MostPlayedGameSlide } from '@/lib/wrapped/types'
import { useTranslations } from 'next-intl'
import { SLIDE_ACCENTS } from '../accents'
import { GlassCard, SlideShell } from '../slide-shell'

type Props = { slide: MostPlayedGameSlide }

export function MostPlayedGameSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS['most-played-game']}>
			{slide.imagePath && (
				<div className="relative h-40 w-40 overflow-hidden rounded-2xl border border-white/10">
					<img
						src={`/api/media?path=${encodeURIComponent(slide.imagePath)}`}
						alt={slide.gameName}
						className="h-full w-full object-cover"
					/>
				</div>
			)}
			<GlassCard className="text-center">
				<p className="text-sm text-white/60 mb-1">{t('mostPlayedGame.title')}</p>
				<h2 className="text-2xl font-black text-white">{slide.gameName}</h2>
				<p className="text-white/50 text-xs mt-1 uppercase tracking-widest">{slide.system}</p>
				<div className="mt-4 flex justify-center gap-6">
					<div className="text-center">
						<p className="text-2xl font-bold text-white">
							{slide.playtimeHours > 0
								? `${slide.playtimeHours}h${slide.playtimeMinutes > 0 ? ` ${slide.playtimeMinutes}m` : ''}`
								: `${slide.playtimeMinutes}m`}
						</p>
						<p className="text-xs text-white/40">played</p>
					</div>
					<div className="text-center">
						<p className="text-2xl font-bold text-white">{slide.sessionCount}</p>
						<p className="text-xs text-white/40">sessions</p>
					</div>
				</div>
			</GlassCard>
		</SlideShell>
	)
}
