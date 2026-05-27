'use client'

import { useEffect, useRef } from 'react'

type Props = {
	total: number
	current: number
	isPaused: boolean
	autoAdvanceDuration: number
	onComplete: () => void
}

export function ProgressBar({ total, current, isPaused, autoAdvanceDuration, onComplete }: Props) {
	const progressRef = useRef<HTMLDivElement | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: current triggers animation reset intentionally
	useEffect(() => {
		const el = progressRef.current
		if (!el || isPaused) return
		el.style.transition = 'none'
		el.style.transform = 'scaleX(0)'
		const raf = requestAnimationFrame(() => {
			el.style.transition = `transform ${autoAdvanceDuration}ms linear`
			el.style.transform = 'scaleX(1)'
		})
		const timer = setTimeout(onComplete, autoAdvanceDuration)
		return () => {
			cancelAnimationFrame(raf)
			clearTimeout(timer)
		}
	}, [current, isPaused, autoAdvanceDuration, onComplete])

	return (
		<div className="absolute top-0 left-0 right-0 flex gap-1 p-2 z-10">
			{Array.from({ length: total }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: positional slide indicators, never reorder
				<div
					key={i}
					className={`relative h-0.5 flex-1 overflow-hidden rounded-full ${i === current ? 'bg-white/40' : 'bg-white/20'}`}
				>
					{i < current && <div className="absolute inset-0 bg-white" />}
					{i === current && (
						<div
							ref={progressRef}
							className="absolute inset-0 origin-left bg-white"
							style={{ transform: 'scaleX(0)' }}
						/>
					)}
				</div>
			))}
		</div>
	)
}
