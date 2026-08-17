'use client'

import { useRouter } from '@/i18n/navigation'
import type { Wrapped } from '@/lib/wrapped/types'
import { useCallback, useRef, useState } from 'react'
import { ProgressBar } from './progress-bar'
import { ShareDialog } from './share-dialog'
import { SlideRenderer } from './slide-renderer'

const AUTO_ADVANCE_MS = 5000

type Props = {
	wrapped: Wrapped
	year: number
	locale: string
}

export function StoryViewer({ wrapped, year, locale }: Props) {
	const [currentIndex, setCurrentIndex] = useState(0)
	const [isPaused, setIsPaused] = useState(false)
	const [shareOpen, setShareOpen] = useState(false)
	const pointerStartX = useRef<number | null>(null)
	const router = useRouter()
	const { slides } = wrapped

	const goTo = useCallback(
		(index: number) => {
			const clampedIndex = Math.max(0, Math.min(index, slides.length - 1))
			if (typeof document !== 'undefined' && document.startViewTransition) {
				document.startViewTransition(() => setCurrentIndex(clampedIndex))
			} else {
				setCurrentIndex(clampedIndex)
			}
		},
		[slides.length],
	)

	/**
	 * Explicit advance — a tap on the right half, or a left swipe. Past the last slide it
	 * leaves the recap for the stats page, so the story has a way out that does not require
	 * hunting for the close button.
	 */
	const handleNext = useCallback(() => {
		if (currentIndex < slides.length - 1) {
			goTo(currentIndex + 1)
			return
		}
		router.push('/stats')
	}, [currentIndex, slides.length, goTo, router])

	/**
	 * The auto-advance timer stops at the last slide instead. Leaving the tab open should
	 * never navigate on its own — exiting stays something the reader decides to do.
	 */
	const handleAutoAdvance = useCallback(() => {
		if (currentIndex < slides.length - 1) goTo(currentIndex + 1)
	}, [currentIndex, slides.length, goTo])

	const handlePrev = useCallback(() => {
		if (currentIndex > 0) goTo(currentIndex - 1)
	}, [currentIndex, goTo])

	const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		pointerStartX.current = e.clientX
	}

	const handlePointerUp = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			const startX = pointerStartX.current
			if (startX === null) return
			const delta = e.clientX - startX
			pointerStartX.current = null
			if (Math.abs(delta) > 50) {
				setIsPaused(true)
				if (delta < 0) handleNext()
				else handlePrev()
			} else {
				if (shareOpen) return
				setIsPaused(true)
				const x = e.clientX
				const width = (e.currentTarget as HTMLDivElement).offsetWidth
				if (x < width / 2) handlePrev()
				else handleNext()
			}
		},
		[shareOpen, handlePrev, handleNext],
	)

	const currentSlide = slides[currentIndex]
	if (!currentSlide) return null

	return (
		<div
			className="relative h-full w-full select-none"
			onPointerDown={handlePointerDown}
			onPointerUp={handlePointerUp}
		>
			<ProgressBar
				total={slides.length}
				current={currentIndex}
				isPaused={isPaused || shareOpen}
				autoAdvanceDuration={AUTO_ADVANCE_MS}
				onComplete={handleAutoAdvance}
			/>

			<div className="h-full w-full" style={{ viewTransitionName: 'wrapped-slide' }}>
				<SlideRenderer slide={currentSlide} wrapped={wrapped} slideIndex={currentIndex} />
			</div>

			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation()
					setShareOpen(true)
				}}
				className="absolute bottom-12 right-6 z-20 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-medium text-white backdrop-blur-sm"
			>
				Share
			</button>

			{shareOpen && (
				<ShareDialog
					year={year}
					slideIndex={currentIndex}
					locale={locale}
					onClose={() => setShareOpen(false)}
				/>
			)}
		</div>
	)
}
