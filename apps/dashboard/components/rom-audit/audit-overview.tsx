import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import type { SystemOverview } from '@/lib/rom-audit/report'
import { getTranslations } from 'next-intl/server'

/** Segment widths of the confidence bar, in percent of the scanned files. */
function shares(system: SystemOverview) {
	const total = system.verified + system.serial + system.named + system.unknown
	if (total === 0) return { verified: 0, serial: 0, named: 0, unknown: 0 }
	return {
		verified: (system.verified / total) * 100,
		serial: (system.serial / total) * 100,
		named: (system.named / total) * 100,
		unknown: (system.unknown / total) * 100,
	}
}

export async function AuditOverview({ systems }: { systems: SystemOverview[] }) {
	const t = await getTranslations('romAudit')

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{systems.map((system) => {
				const s = shares(system)
				return (
					<Card key={system.system}>
						<CardHeader className="pb-2">
							<div className="flex items-baseline justify-between gap-2">
								<CardTitle className="text-base">{system.system}</CardTitle>
								{/* A system with no catalogue has no completion rate; showing 0 %
								    would claim an empty collection, which is a different thing. */}
								<span className="font-bold text-lg tabular-nums">
									{system.percent === null ? (
										<Badge variant="outline">{t('overview.inventoryOnly')}</Badge>
									) : (
										`${system.percent.toFixed(1)} %`
									)}
								</span>
							</div>
							{system.datName && (
								<p className="truncate text-muted-foreground text-xs">{system.datName}</p>
							)}
						</CardHeader>

						<CardContent className="space-y-3">
							<div className="flex h-2 overflow-hidden rounded-full bg-muted">
								<div className="bg-emerald-500" style={{ width: `${s.verified}%` }} />
								<div className="bg-sky-500" style={{ width: `${s.serial}%` }} />
								<div className="bg-amber-500" style={{ width: `${s.named}%` }} />
								<div className="bg-muted-foreground/40" style={{ width: `${s.unknown}%` }} />
							</div>

							<div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
								<span>✅ {system.verified}</span>
								<span>◆ {system.serial}</span>
								<span>~ {system.named}</span>
								<span>? {system.unknown}</span>
							</div>

							<div className="flex items-center justify-between text-xs">
								<span className="text-muted-foreground">
									{t('overview.files', { count: system.filesScanned })}
								</span>
								<Link
									href={`/collection/audit?system=${encodeURIComponent(system.system)}`}
									className="font-medium text-primary hover:underline"
								>
									{t('overview.details')}
								</Link>
							</div>

							{system.mounts.length > 0 && (
								<p className="truncate text-[11px] text-muted-foreground">
									{system.mounts.join(' · ')}
								</p>
							)}
						</CardContent>
					</Card>
				)
			})}
		</div>
	)
}
