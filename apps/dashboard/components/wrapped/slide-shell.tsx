'use client'

import { cn } from '@/lib/utils'

type Props = {
	accent: string
	children: React.ReactNode
	className?: string
}

export function SlideShell({ accent, children, className }: Props) {
	return (
		<div className="relative h-full w-full overflow-hidden bg-[#0a0a0a]">
			{/* Animated glow */}
			<div
				className="absolute inset-0 transition-all duration-700"
				style={{
					background: `radial-gradient(ellipse 80% 60% at 50% 35%, ${accent}33, transparent 70%)`,
				}}
			/>
			{/* Glass card layer */}
			<div className={cn('relative flex h-full w-full flex-col items-center justify-center gap-6 p-6', className)}>
				{children}
			</div>
			{/* Watermark */}
			<div className="absolute bottom-4 right-4 text-[10px] text-white/25 select-none pointer-events-none">
				github.com/m-meddah/recalbox-dashboard
			</div>
		</div>
	)
}

type GlassCardProps = {
	children: React.ReactNode
	className?: string
}

export function GlassCard({ children, className }: GlassCardProps) {
	return (
		<div
			className={cn(
				'w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl',
				className,
			)}
		>
			{children}
		</div>
	)
}
