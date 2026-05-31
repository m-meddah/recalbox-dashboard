'use client'

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

type ResponseOption = {
	value: string
	label: string
	emoji: string
}

const OPTIONS_BY_CLASSIFICATION: Record<string, { question: string; options: ResponseOption[] }> = {
	bounce: {
		question: 'Pas accroché ?',
		options: [
			{ value: 'not_for_me', label: 'Pas pour moi', emoji: '👎' },
			{ value: 'come_back_later', label: "J'y reviendrai", emoji: '⏸' },
			{ value: 'good_but_timing', label: 'Mauvais timing', emoji: '👍' },
		],
	},
	taste: {
		question: "Comment c'était cet aperçu ?",
		options: [
			{ value: 'meh', label: 'Bof', emoji: '👎' },
			{ value: 'mixed', label: 'Mitigé', emoji: '🤔' },
			{ value: 'want_more', label: "J'en veux plus", emoji: '👍' },
		],
	},
	meaningful: {
		question: "Comment c'était ?",
		options: [
			{ value: 'so_so', label: 'Bof', emoji: '😐' },
			{ value: 'good', label: 'Bien', emoji: '👍' },
			{ value: 'excellent', label: 'Excellent', emoji: '⭐' },
		],
	},
	marathon: {
		question: "Belle session ! Ça t'a plu ?",
		options: [
			{ value: 'good', label: 'Bien', emoji: '👍' },
			{ value: 'excellent', label: 'Excellent', emoji: '⭐' },
			{ value: 'memorable', label: 'Marquant', emoji: '🤩' },
		],
	},
}

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`
	const min = Math.round(seconds / 60)
	if (min < 60) return `${min} min`
	const h = Math.floor(min / 60)
	const m = min % 60
	return m === 0 ? `${h}h` : `${h}h${m.toString().padStart(2, '0')}`
}

export type FeedbackItem = {
	id: number
	gameId: number
	name: string
	system: string
	imagePath: string | null
	durationSeconds: number
	classification: string
	shownAt?: string | null
}

export type FeedbackToastProps = {
	feedback: FeedbackItem
	variant?: 'floating' | 'inline'
	onRespond: (response: string) => void
	onDismiss: () => void
}

export function FeedbackToast({
	feedback,
	variant = 'floating',
	onRespond,
	onDismiss,
}: FeedbackToastProps) {
	const config = OPTIONS_BY_CLASSIFICATION[feedback.classification] ?? {
		question: "Comment c'était ?",
		options: [
			{ value: 'so_so', label: 'Bof', emoji: '😐' },
			{ value: 'good', label: 'Bien', emoji: '👍' },
			{ value: 'excellent', label: 'Excellent', emoji: '⭐' },
		],
	}

	return (
		<div
			className={cn(
				variant === 'floating' &&
					'fixed bottom-4 right-4 z-50 w-full max-w-sm animate-in slide-in-from-bottom-4 duration-300',
				variant === 'inline' && 'w-full',
			)}
		>
			<Card className={cn(variant === 'floating' && 'shadow-lg border-primary/30')}>
				<CardContent className="p-4 space-y-3">
					<div className="flex items-start gap-3">
						{feedback.imagePath && (
							<Image
								src={`/api/media?path=${encodeURIComponent(feedback.imagePath)}`}
								alt=""
								width={48}
								height={48}
								className="size-12 rounded object-cover bg-muted shrink-0"
							/>
						)}
						<div className="min-w-0 flex-1">
							<p className="font-medium text-sm truncate">{feedback.name}</p>
							<p className="text-xs text-muted-foreground">
								{formatDuration(feedback.durationSeconds)} · {feedback.system}
							</p>
						</div>
						<button
							onClick={onDismiss}
							className="text-muted-foreground hover:text-foreground shrink-0"
							aria-label="Fermer"
							type="button"
						>
							<X className="size-4" />
						</button>
					</div>

					<p className="text-sm font-medium">{config.question}</p>

					<div className="grid grid-cols-3 gap-1.5">
						{config.options.map((opt) => (
							<Button
								key={opt.value}
								variant="outline"
								size="sm"
								onClick={() => onRespond(opt.value)}
								className="flex-col h-auto py-2 px-1 gap-0.5"
								type="button"
							>
								<span className="text-lg leading-none">{opt.emoji}</span>
								<span className="text-[10px] leading-tight">{opt.label}</span>
							</Button>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
