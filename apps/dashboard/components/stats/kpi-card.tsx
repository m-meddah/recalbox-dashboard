import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { KpiDelta } from '@/lib/stats/calculators'
import { getTranslations } from 'next-intl/server'
import type { LucideIcon } from 'lucide-react'
import { TrendingDown, TrendingUp } from 'lucide-react'

type KpiCardProps = {
	label: string
	value: string
	delta?: KpiDelta
	icon: LucideIcon
	description?: string
}

export async function KpiCard({ label, value, delta, icon: Icon, description }: KpiCardProps) {
	const t = await getTranslations('stats.kpi')

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="flex items-center justify-between text-muted-foreground font-normal text-xs uppercase tracking-wide">
					<span>{label}</span>
					<Icon className="h-4 w-4 text-muted-foreground" />
				</CardTitle>
			</CardHeader>
			<CardContent className="pt-0">
				<p className="text-2xl font-bold tabular-nums">{value}</p>
				{delta && (
					<p
						className={`mt-1 flex items-center gap-1 text-xs ${
							delta.direction === 'up'
								? 'text-emerald-500'
								: delta.direction === 'down'
									? 'text-red-500'
									: 'text-muted-foreground'
						}`}
					>
						{delta.direction === 'up' ? (
							<TrendingUp className="h-3 w-3" />
						) : delta.direction === 'down' ? (
							<TrendingDown className="h-3 w-3" />
						) : null}
						{delta.value}%<span className="text-muted-foreground">{t('vsPrevious')}</span>
					</p>
				)}
				{description && !delta && (
					<p className="mt-1 text-xs text-muted-foreground">{description}</p>
				)}
			</CardContent>
		</Card>
	)
}
