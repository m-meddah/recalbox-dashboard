import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Clock, Gamepad2, ListOrdered, Flame } from 'lucide-react'
import { getDashboardStats } from '@/lib/stats/calculators'
import { formatDuration } from '@/lib/stats/formatters'
import { KpiCard } from '@/components/stats/kpi-card'
import { ActivityHeatmap } from '@/components/stats/activity-heatmap'
import { PlaytimeChart } from '@/components/stats/playtime-chart'
import { SystemDistribution } from '@/components/stats/system-distribution'
import { TopGames } from '@/components/stats/top-games'
import { StreakCard } from '@/components/stats/streak-card'
import { SessionTimeline } from '@/components/stats/session-timeline'
import { Separator } from '@/components/ui/separator'
import type { Period } from '@/lib/stats/calculators'

const PERIODS = ['week', 'month', 'year', 'all'] as const
const PERIOD_LABELS: Record<Period, string> = {
  week: 'Cette semaine',
  month: 'Ce mois',
  year: 'Cette année',
  all: 'Tout',
}

type Props = {
  params: Promise<{ period: string }>
}

export default async function StatsPage({ params }: Props) {
  const { period: rawPeriod } = await params

  if (!PERIODS.includes(rawPeriod as Period)) notFound()
  const period = rawPeriod as Period

  const stats = await getDashboardStats(period)

  return (
    <div className="container mx-auto max-w-screen-xl space-y-8 px-4 py-8">
      {/* Header + period tabs */}
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Statistiques</h1>
        <nav className="flex gap-1 rounded-xl border bg-muted/40 p-1 w-fit">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/stats/${p}`}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                p === period
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </nav>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Temps de jeu"
          value={formatDuration(stats.kpi.totalPlaytimeSec)}
          delta={stats.kpi.delta?.playtime}
          icon={Clock}
        />
        <KpiCard
          label="Jeux joués"
          value={String(stats.kpi.uniqueGames)}
          icon={Gamepad2}
        />
        <KpiCard
          label="Sessions"
          value={String(stats.kpi.totalSessions)}
          delta={stats.kpi.delta?.sessions}
          icon={ListOrdered}
        />
        <KpiCard
          label="Série actuelle"
          value={`${stats.kpi.currentStreak}j`}
          description={`Record : ${stats.kpi.longestStreak} jour${stats.kpi.longestStreak > 1 ? 's' : ''}`}
          icon={Flame}
        />
      </div>

      {/* Heatmap */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Activité — 365 derniers jours
        </h2>
        <ActivityHeatmap heatmap={stats.heatmap} />
      </section>

      <Separator />

      {/* Playtime chart */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Temps de jeu par jour
        </h2>
        <PlaytimeChart data={stats.playtimeByDay} period={period} />
      </section>

      <Separator />

      {/* Top games + System distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Top jeux
          </h2>
          <TopGames games={stats.topGames} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Par système
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
            Dernières sessions
          </h2>
          <SessionTimeline sessions={stats.recentSessions} />
        </section>
      </div>
    </div>
  )
}
