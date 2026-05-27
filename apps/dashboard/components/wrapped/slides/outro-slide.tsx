import { Link } from '@/i18n/navigation'
import type { OutroSlide } from '@/lib/wrapped/types'
import { useTranslations } from 'next-intl'
import { SLIDE_ACCENTS } from '../accents'
import { GlassCard, SlideShell } from '../slide-shell'

type Props = { slide: OutroSlide; shareSlideIndex: number }

export function OutroSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS.outro}>
			<div className="text-6xl">🎮</div>
			<GlassCard className="text-center">
				<h2 className="text-3xl font-black text-white">{t('outro.title')}</h2>
				<p className="text-white/50 mt-1 text-sm">
					{slide.year} ·{' '}
					{slide.totalHours > 0
						? `${slide.totalHours}h${slide.totalMinutes > 0 ? ` ${slide.totalMinutes}m` : ''}`
						: `${slide.totalMinutes}m`}
				</p>
				<Link href="/wrapped" className="mt-4 block text-sm text-white/60 underline">
					{t('outro.archive')}
				</Link>
			</GlassCard>
		</SlideShell>
	)
}
