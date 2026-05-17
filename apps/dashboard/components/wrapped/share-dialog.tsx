'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'

type Format = 'story' | 'square' | 'landscape'

type Props = {
	year: number
	slideIndex: number
	locale: string
	onClose: () => void
}

export function ShareDialog({ year, slideIndex, locale, onClose }: Props) {
	const t = useTranslations('wrapped.share')
	const [format, setFormat] = useState<Format>('story')

	const imageUrl = `/${locale}/wrapped/${year}/share/${slideIndex}?format=${format}`

	async function handleShare() {
		try {
			const res = await fetch(imageUrl)
			const blob = await res.blob()
			const file = new File([blob], `wrapped-${year}-slide-${slideIndex}.png`, { type: 'image/png' })

			if (navigator.canShare?.({ files: [file] })) {
				await navigator.share({ files: [file], title: `Recalbox Wrapped ${year}` })
			} else {
				const url = URL.createObjectURL(blob)
				const a = document.createElement('a')
				a.href = url
				a.download = file.name
				a.click()
				URL.revokeObjectURL(url)
			}
		} catch {
			// share cancelled
		}
	}

	const formats: Format[] = ['story', 'square', 'landscape']

	return (
		<div
			className="absolute inset-0 z-30 flex items-end justify-center bg-black/60 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="w-full max-w-sm rounded-t-3xl border-t border-white/10 bg-[#111] p-6"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-white font-bold">{t('title')}</h3>
					<button onClick={onClose} className="text-white/50 hover:text-white">
						<X className="h-5 w-5" />
					</button>
				</div>

				<div className="flex gap-2 mb-4">
					{formats.map((f) => (
						<button
							key={f}
							onClick={() => setFormat(f)}
							className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors ${
								format === f
									? 'bg-white text-black'
									: 'bg-white/10 text-white/60 hover:bg-white/20'
							}`}
						>
							{t(f)}
						</button>
					))}
				</div>

				<div className="mb-4 flex justify-center rounded-xl overflow-hidden bg-black border border-white/10 h-40">
					<img
						src={imageUrl}
						alt="Preview"
						className="h-full w-auto object-contain"
					/>
				</div>

				<button
					onClick={handleShare}
					className="w-full rounded-xl bg-white py-3 text-sm font-bold text-black"
				>
					{typeof navigator !== 'undefined' && navigator.canShare?.({ files: [] }) ? t('shareNative') : t('download')}
				</button>
			</div>
		</div>
	)
}
