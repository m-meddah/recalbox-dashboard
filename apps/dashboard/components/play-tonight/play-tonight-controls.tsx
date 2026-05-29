'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { AvailableTime, Mood } from '@/lib/recommendations/types'
import { cn } from '@/lib/utils'
import { Clock, Coffee, Compass, Flag, Heart, Sparkles, Sword } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'

const MOOD_VALUES: { value: Mood; icon: ComponentType<{ className?: string }> }[] = [
	{ value: 'surprise', icon: Sparkles },
	{ value: 'chill', icon: Coffee },
	{ value: 'challenge', icon: Sword },
	{ value: 'nostalgia', icon: Heart },
	{ value: 'discovery', icon: Compass },
	{ value: 'finish', icon: Flag },
]

export function PlayTonightControls({
	time,
	mood,
	onTimeChange,
	onMoodChange,
	onSubmit,
}: {
	time: AvailableTime
	mood: Mood
	onTimeChange: (t: AvailableTime) => void
	onMoodChange: (m: Mood) => void
	onSubmit: () => void
}) {
	const t = useTranslations('playTonight.controls')

	const times: { value: AvailableTime; label: string }[] = [
		{ value: 30, label: '~30 min' },
		{ value: 60, label: '1 h' },
		{ value: 120, label: '2 h' },
		{ value: 240, label: t('times.evening') },
	]

	return (
		<Card>
			<CardContent className="py-6 space-y-6">
				<div className="space-y-2">
					<p className="text-sm font-medium flex items-center gap-2">
						<Clock className="w-4 h-4" /> {t('timeLabel')}
					</p>
					<div className="grid grid-cols-4 gap-2">
						{times.map((item) => (
							<button
								key={item.value}
								onClick={() => onTimeChange(item.value)}
								type="button"
								className={cn(
									'px-3 py-2 rounded-md border text-sm transition-colors',
									time === item.value
										? 'border-primary bg-primary/10 font-medium'
										: 'border-border hover:bg-muted/50',
								)}
							>
								{item.label}
							</button>
						))}
					</div>
				</div>
				<div className="space-y-2">
					<p className="text-sm font-medium">{t('moodLabel')}</p>
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
						{MOOD_VALUES.map(({ value, icon: Icon }) => (
							<button
								key={value}
								onClick={() => onMoodChange(value)}
								type="button"
								className={cn(
									'flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm transition-colors',
									mood === value
										? 'border-primary bg-primary/10 font-medium'
										: 'border-border hover:bg-muted/50',
								)}
							>
								<Icon className="w-4 h-4 shrink-0" />
								<span className="truncate">{t(`moods.${value}`)}</span>
							</button>
						))}
					</div>
				</div>
				<Button className="w-full" size="lg" onClick={onSubmit}>
					{t('submit')}
				</Button>
			</CardContent>
		</Card>
	)
}
