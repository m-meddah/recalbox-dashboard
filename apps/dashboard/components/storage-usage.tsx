import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StorageMount } from '@/lib/recalbox/storage'
import { HardDrive } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Go`
	if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} Mo`
	return `${Math.round(bytes / 1024)} Ko`
}

// Translucent fill for the storage rows so the overlaid text stays readable in
// both light and dark themes. Literal class names for Tailwind's scanner.
function fillColor(pct: number): string {
	if (pct >= 90) return 'bg-red-500/25'
	if (pct >= 70) return 'bg-warning/30'
	return 'bg-accent/35'
}

export function StorageUsage({ storage }: { storage: StorageMount[] }) {
	const t = useTranslations('dashboard.system')
	if (storage.length === 0) return null
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">{t('storage')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2.5">
				{storage.map((s) => (
					<div
						key={s.mount}
						className="relative h-14 overflow-hidden rounded-md border bg-muted/40"
					>
						<div
							className={`absolute inset-y-0 left-0 transition-all ${fillColor(s.percent)}`}
							style={{ width: `${Math.min(100, Math.max(0, s.percent))}%` }}
						/>
						<div className="relative flex h-full items-center gap-3 px-2.5">
							<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground shadow-sm">
								<HardDrive className="size-5" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2 text-sm">
									<span className="truncate font-medium">{s.label}</span>
									<span className="shrink-0 font-semibold tabular-nums">{s.percent}%</span>
								</div>
								<div className="text-xs text-muted-foreground tabular-nums">
									{formatBytes(s.usedBytes)} / {formatBytes(s.sizeBytes)}
								</div>
							</div>
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	)
}
