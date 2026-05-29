'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Clock, Coffee, Sword, Heart, Compass, Flag, Sparkles } from 'lucide-react'
import type { Mood, AvailableTime } from '@/lib/recommendations/types'
import type { ComponentType } from 'react'

const TIMES: { value: AvailableTime; label: string }[] = [
	{ value: 30, label: '~30 min' },
	{ value: 60, label: '1 h' },
	{ value: 120, label: '2 h' },
	{ value: 240, label: 'Soirée' },
]

const MOODS: { value: Mood; label: string; icon: ComponentType<{ className?: string }> }[] = [
	{ value: 'surprise', label: 'Surprends-moi', icon: Sparkles },
	{ value: 'chill', label: 'Chill', icon: Coffee },
	{ value: 'challenge', label: 'Défi', icon: Sword },
	{ value: 'nostalgia', label: 'Nostalgie', icon: Heart },
	{ value: 'discovery', label: 'Découverte', icon: Compass },
	{ value: 'finish', label: 'Finir un truc', icon: Flag },
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
	return (
		<Card>
			<CardContent className="py-6 space-y-6">
				<div className="space-y-2">
					<label className="text-sm font-medium flex items-center gap-2">
						<Clock className="w-4 h-4" /> Temps disponible
					</label>
					<div className="grid grid-cols-4 gap-2">
						{TIMES.map((t) => (
							<button
								key={t.value}
								onClick={() => onTimeChange(t.value)}
								type="button"
								className={cn(
									'px-3 py-2 rounded-md border text-sm transition-colors',
									time === t.value
										? 'border-primary bg-primary/10 font-medium'
										: 'border-border hover:bg-muted/50',
								)}
							>
								{t.label}
							</button>
						))}
					</div>
				</div>
				<div className="space-y-2">
					<label className="text-sm font-medium">Humeur</label>
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
						{MOODS.map((m) => {
							const Icon = m.icon
							return (
								<button
									key={m.value}
									onClick={() => onMoodChange(m.value)}
									type="button"
									className={cn(
										'flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm transition-colors',
										mood === m.value
											? 'border-primary bg-primary/10 font-medium'
											: 'border-border hover:bg-muted/50',
									)}
								>
									<Icon className="w-4 h-4 shrink-0" />
									<span className="truncate">{m.label}</span>
								</button>
							)
						})}
					</div>
				</div>
				<Button className="w-full" size="lg" onClick={onSubmit}>
					Trouver 3 jeux
				</Button>
			</CardContent>
		</Card>
	)
}
