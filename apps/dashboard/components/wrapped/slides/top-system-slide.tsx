import type { TopSystemSlide } from '@/lib/wrapped/types'
import { useTranslations } from 'next-intl'
import { SLIDE_ACCENTS } from '../accents'
import { GlassCard, SlideShell } from '../slide-shell'

type Props = { slide: TopSystemSlide }

export function TopSystemSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS['top-system']}>
			<GlassCard className="text-center">
				<p className="text-sm text-white/60 mb-2">{t('topSystem.title')}</p>
				<h2 className="text-4xl font-black text-white uppercase tracking-wider">{slide.system}</h2>
				<p className="text-white/60 mt-2 text-lg">
					{t('topSystem.percentage', { percent: slide.percentage })}
				</p>
			</GlassCard>
			<div className="w-full max-w-sm space-y-2">
				{slide.breakdown.slice(0, 5).map((s) => (
					<div key={s.system} className="flex items-center gap-3">
						<span className="w-20 text-xs text-white/60 uppercase truncate">{s.system}</span>
						<div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
							<div
								className="h-full rounded-full bg-white/60"
								style={{ width: `${s.percentage}%` }}
							/>
						</div>
						<span className="text-xs text-white/40 w-8 text-right">{s.percentage}%</span>
					</div>
				))}
			</div>
		</SlideShell>
	)
}
