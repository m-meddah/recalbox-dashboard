'use client'

import { motion } from 'motion/react'
import type { TopGamesListSlide } from '@/lib/wrapped/types'
import { SlideShell, GlassCard } from '../slide-shell'
import { SLIDE_ACCENTS } from '../accents'
import { useTranslations } from 'next-intl'

type Props = { slide: TopGamesListSlide }

export function TopGamesListSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS['top-games-list']}>
			<GlassCard>
				<p className="text-sm text-white/60 mb-4">{t('topGamesList.title')}</p>
				<div className="space-y-3">
					{slide.games.map((game, i) => (
						<motion.div
							key={game.gameName}
							initial={{ opacity: 0, x: -20 }}
							animate={{ opacity: 1, x: 0 }}
							transition={{ delay: i * 0.12, duration: 0.35, ease: 'easeOut' }}
							className="flex items-center justify-between"
						>
							<div className="flex items-center gap-3">
								<span className="text-white/30 w-5 text-sm font-bold">#{game.rank}</span>
								<div>
									<p className="text-sm font-bold text-white leading-none">{game.gameName}</p>
									<p className="text-xs text-white/40 uppercase mt-0.5">{game.system}</p>
								</div>
							</div>
							<span className="text-sm font-bold text-white/70">{game.playtimeHours}h</span>
						</motion.div>
					))}
				</div>
			</GlassCard>
		</SlideShell>
	)
}
