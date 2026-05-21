import { ActivityHeatmap } from '@/components/stats/activity-heatmap'
import { KpiCard } from '@/components/stats/kpi-card'
import { PlaytimeChart } from '@/components/stats/playtime-chart'
import { SessionTimeline } from '@/components/stats/session-timeline'
import { StreakCard } from '@/components/stats/streak-card'
import { SystemDistribution } from '@/components/stats/system-distribution'
import { TopGames } from '@/components/stats/top-games'
import { Separator } from '@/components/ui/separator'
import { WrappedPreviewBanner } from '@/components/wrapped/wrapped-preview-banner'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { getDashboardStats } from '@/lib/stats/calculators'
import type { Period } from '@/lib/stats/calculators'
import { formatDuration } from '@/lib/stats/formatters'
import { getWrappedPreview } from '@/lib/wrapped/preview'
import { Clock, Flame, Gamepad2, ListOrdered } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'

const PERIODS = ['week', 'month', 'year', 'all'] as const

type Props = {
	params: Promise<{ period: string; locale: string }>
}

export default async function StatsPage({ params }: Props) {
	const { period: rawPeriod, locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	if (!PERIODS.includes(rawPeriod as Period)) notFound()
	const period = rawPeriod as Period

	const currentYear = new Date().getFullYear()
	const [stats, t, wrappedPreview] = await Promise.all([
		getDashboardStats(period),
		getTranslations('stats'),
		getWrappedPreview(currentYear),
	])

	return (
		<div className="container mx-auto max-w-screen-xl space-y-8 px-4 py-8">
			{/* Wrapped preview banner */}
			{wrappedPreview && (
				<WrappedPreviewBanner
					year={currentYear}
					hours={wrappedPreview.hours}
					topGame={wrappedPreview.topGame}
				/>
			)}

			{/* Header + period tabs */}
			<div className="space-y-4">
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<div className="overflow-x-auto">
					<nav className="flex gap-1 rounded-xl border bg-muted/40 p-1 w-fit min-w-full sm:min-w-fit">
						{PERIODS.map((p) => (
							<Link
								key={p}
								href={`/stats/${p}`}
								className={`rounded-lg px-2 sm:px-4 py-1.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
									p === period
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
								}`}
							>
								{t(`periods.${p}`)}
							</Link>
						))}
					</nav>
				</div>
			</div>

			{/* KPI cards */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<KpiCard
					label={t('kpi.playtime')}
					value={formatDuration(stats.kpi.totalPlaytimeSec)}
					delta={stats.kpi.delta?.playtime}
					icon={Clock}
				/>
				<KpiCard
					label={t('kpi.gamesPlayed')}
					value={String(stats.kpi.uniqueGames)}
					icon={Gamepad2}
				/>
				<KpiCard
					label={t('kpi.sessions')}
					value={String(stats.kpi.totalSessions)}
					delta={stats.kpi.delta?.sessions}
					icon={ListOrdered}
				/>
				<KpiCard
					label={t('kpi.currentStreak')}
					value={t('kpi.streakDays', { count: stats.kpi.currentStreak })}
					description={t('streak.record', { days: stats.kpi.longestStreak })}
					icon={Flame}
				/>
			</div>

			{/* Heatmap */}
			<section className="space-y-3">
				<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					{t('sections.activity')}
				</h2>
				<ActivityHeatmap heatmap={stats.heatmap} />
			</section>

			<Separator />

			{/* Playtime chart */}
			<section className="space-y-3">
				<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					{t('sections.dailyPlaytime')}
				</h2>
				<PlaytimeChart data={stats.playtimeByDay} period={period} />
			</section>

			<Separator />

			{/* Top games + System distribution */}
			<div className="grid gap-6 lg:grid-cols-2">
				<section className="space-y-3">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						{t('sections.topGames')}
					</h2>
					<TopGames games={stats.topGames} />
				</section>

				<section className="space-y-3">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						{t('sections.bySystem')}
					</h2>
					<SystemDistribution data={stats.bySystem} />
				</section>
			</div>

			<Separator />

			{/* Streak + Timeline */}
			<div className="grid gap-6 lg:grid-cols-[200px_1fr]">
				<StreakCard
					currentStreak={stats.kpi.currentStreak}
					longestStreak={stats.kpi.longestStreak}
				/>
				<section className="space-y-3">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						{t('sections.recentSessions')}
					</h2>
					<SessionTimeline sessions={stats.recentSessions} />
				</section>
			</div>
		</div>
	)
}
