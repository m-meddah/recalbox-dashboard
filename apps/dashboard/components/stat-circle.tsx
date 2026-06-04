import { cn } from '@/lib/utils'

type StatCircleProps = {
	/** Big value shown in the center. */
	value: string | number
	/** Caption under the value. */
	label: string
	/** When set (0–100), draws a teal progress arc instead of a full ring. */
	percent?: number
	className?: string
}

/**
 * Circular stat indicator inspired by the Recalbox Web Manager "APERÇU" donuts.
 * Pure SVG, no client JS.
 */
export function StatCircle({ value, label, percent, className }: StatCircleProps) {
	const size = 132
	const stroke = 10
	const r = (size - stroke) / 2
	const c = 2 * Math.PI * r
	const pct = percent == null ? null : Math.max(0, Math.min(100, percent))
	const dash = pct == null ? c : (pct / 100) * c

	return (
		<div className={cn('flex flex-col items-center gap-2', className)}>
			<div className="relative" style={{ width: size, height: size }}>
				<svg
					width={size}
					height={size}
					viewBox={`0 0 ${size} ${size}`}
					className="-rotate-90"
					role="img"
				>
					<title>{label}</title>
					<circle
						cx={size / 2}
						cy={size / 2}
						r={r}
						fill="none"
						stroke="var(--muted)"
						strokeWidth={stroke}
					/>
					<circle
						cx={size / 2}
						cy={size / 2}
						r={r}
						fill="none"
						stroke={pct == null ? 'var(--accent)' : 'var(--primary)'}
						strokeWidth={stroke}
						strokeLinecap="round"
						strokeDasharray={`${dash} ${c}`}
					/>
				</svg>
				<div className="absolute inset-0 flex flex-col items-center justify-center">
					<span className="text-3xl font-bold tracking-tight text-foreground">{value}</span>
				</div>
			</div>
			<span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
				{label}
			</span>
		</div>
	)
}
