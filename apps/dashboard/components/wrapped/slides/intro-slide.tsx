import type { IntroSlide, Wrapped } from '@/lib/wrapped/types'
import { useTranslations } from 'next-intl'
import { SLIDE_ACCENTS } from '../accents'
import { GlassCard, SlideShell } from '../slide-shell'

type Props = { slide: IntroSlide; wrapped: Wrapped }

export function IntroSlideView({ wrapped }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS.intro}>
			<div className="flex flex-col items-center gap-2 text-center">
				<span className="text-6xl">🕹️</span>
			</div>
			<GlassCard className="text-center">
				<p className="text-sm text-white/60 mb-2">{wrapped.user.pseudo ?? 'Recalbox'}</p>
				<h1 className="text-3xl font-black text-white leading-tight">
					{t('intro.title', { year: wrapped.year })}
				</h1>
				<p className="text-white/60 mt-3 text-sm">{t('intro.subtitle')}</p>
			</GlassCard>
		</SlideShell>
	)
}
