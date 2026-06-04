import { cn } from '@/lib/utils'
import type * as React from 'react'

/**
 * Uppercase, letter-spaced muted label used as a section heading,
 * matching the Recalbox Web Manager's section titles (e.g. "SYSTÈME EN COURS").
 */
function SectionLabel({ className, ...props }: React.ComponentProps<'h2'>) {
	return (
		<h2
			data-slot="section-label"
			className={cn(
				'text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase',
				className,
			)}
			{...props}
		/>
	)
}

/**
 * A settings row: right-aligned uppercase label on the left, control on the
 * right — the layout used throughout the Web Manager's Configuration pages.
 */
function SettingRow({
	label,
	hint,
	children,
	className,
	...props
}: React.ComponentProps<'div'> & { label: React.ReactNode; hint?: React.ReactNode }) {
	return (
		<div
			data-slot="setting-row"
			className={cn(
				'grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[minmax(0,12rem)_1fr] sm:gap-6',
				className,
			)}
			{...props}
		>
			<div className="flex flex-col gap-0.5 sm:items-end sm:text-right">
				<span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
					{label}
				</span>
				{hint ? <span className="text-xs text-muted-foreground/80">{hint}</span> : null}
			</div>
			<div className="min-w-0">{children}</div>
		</div>
	)
}

export { SectionLabel, SettingRow }
