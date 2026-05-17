'use client'

import { motion } from 'motion/react'
import type { UnlocksSlide } from '@/lib/wrapped/types'
import { SlideShell, GlassCard } from '../slide-shell'
import { SLIDE_ACCENTS } from '../accents'
import { useTranslations } from 'next-intl'

type Props = { slide: UnlocksSlide }

const RARITY_COLORS: Record<string, string> = {
	common: 'text-gray-400',
	uncommon: 'text-green-400',
	rare: 'text-blue-400',
	legendary: 'text-yellow-400',
}

export function UnlocksSlideView({ slide }: Props) {
	const t = useTranslations('wrapped')
	return (
		<SlideShell accent={SLIDE_ACCENTS['unlocks']}>
			<GlassCard>
				<p className="text-sm text-white/60 mb-4">{t('unlocks.title')}</p>
				<div className="space-y-3">
					{slide.unlocks.map((unlock, i) => (
						<motion.div
							key={unlock.id}
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: i * 0.15, duration: 0.35 }}
							className="flex items-start gap-3"
						>
							<div>
								<p className="text-sm font-bold text-white">{unlock.title}</p>
								<p className="text-xs text-white/50 mt-0.5">{unlock.description}</p>
								<p className={`text-xs mt-0.5 font-medium ${RARITY_COLORS[unlock.rarity]}`}>
									{t(`unlocks.rarity.${unlock.rarity}`)}
								</p>
							</div>
						</motion.div>
					))}
				</div>
			</GlassCard>
		</SlideShell>
	)
}
