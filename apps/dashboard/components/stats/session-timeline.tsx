import { ScrollArea } from '@/components/ui/scroll-area'
import type { RecentSession } from '@/lib/stats/calculators'
import { formatDuration, formatRelativeDate } from '@/lib/stats/formatters'
import { getLocale, getTranslations } from 'next-intl/server'

type Props = {
	sessions: RecentSession[]
}

const SYSTEM_COLORS: Record<string, string> = {
	snes: 'bg-violet-500/20 text-violet-400',
	nes: 'bg-red-500/20 text-red-400',
	gba: 'bg-indigo-500/20 text-indigo-400',
	gbc: 'bg-green-500/20 text-green-400',
	gb: 'bg-green-700/20 text-green-500',
	psx: 'bg-blue-500/20 text-blue-400',
	megadrive: 'bg-gray-500/20 text-gray-400',
	n64: 'bg-yellow-500/20 text-yellow-400',
	arcade: 'bg-orange-500/20 text-orange-400',
	nds: 'bg-pink-500/20 text-pink-400',
}

function systemBadgeClass(system: string): string {
	return SYSTEM_COLORS[system.toLowerCase()] ?? 'bg-muted text-muted-foreground'
}

export async function SessionTimeline({ sessions }: Props) {
	const [t, locale] = await Promise.all([getTranslations('stats.timeline'), getLocale()])

	if (sessions.length === 0) {
		return <p className="py-4 text-center text-sm text-muted-foreground">{t('empty')}</p>
	}

	return (
		<ScrollArea className="h-80">
			<div className="space-y-1 pr-3">
				{sessions.map((s) => (
					<div
						key={s.id}
						className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
					>
						<div className="shrink-0 text-right">
							<p className="text-xs font-mono text-muted-foreground">
								{s.startedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
							</p>
							<p className="text-[10px] text-muted-foreground/60">
								{formatRelativeDate(s.startedAt, locale)}
							</p>
						</div>
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">{s.gameName}</p>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<span
								className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${systemBadgeClass(s.system)}`}
							>
								{s.system}
							</span>
							<span className="text-xs font-mono text-muted-foreground">
								{formatDuration(s.durationSec)}
							</span>
						</div>
					</div>
				))}
			</div>
		</ScrollArea>
	)
}
