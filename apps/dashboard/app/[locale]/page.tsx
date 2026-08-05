import { FeedbackInboxNudge } from '@/components/feedback/feedback-inbox-nudge'
import { MonitoringPanel } from '@/components/monitoring-panel'
import { NowPlaying } from '@/components/now-playing'
import { OverviewHero } from '@/components/overview-hero'
import { RefreshLiveState } from '@/components/refresh-live-state'
import { SystemStatsChart } from '@/components/system-stats-chart'
import { SectionLabel } from '@/components/ui/section-label'
import type { routing } from '@/i18n/routing'
import { db } from '@/lib/db'
import { getAgentLastSeen } from '@/lib/db/agent-liveness'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { isServerlessMode } from '@/lib/serverless'
import { setRequestLocale } from 'next-intl/server'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'

type Props = {
	params: Promise<{ locale: string }>
}

export default async function Home({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])
	const t = await getTranslations('dashboard')

	const serverless = isServerlessMode()
	// Only the last-signal timestamp is needed here — the game state already reaches
	// the UI through the provider, seeded by the layout. One query, not a second seed.
	const activeRecalboxId = serverless ? await getActiveRecalboxId() : null
	const lastSeenAt = activeRecalboxId
		? ((await getAgentLastSeen(db)).get(activeRecalboxId) ?? null)
		: null

	return (
		<main className="container mx-auto max-w-6xl space-y-8 px-4 py-8">
			<Suspense fallback={null}>
				<OverviewHero />
			</Suspense>
			<FeedbackInboxNudge />
			<div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
				<section className="space-y-4">
					<SectionLabel>{t('nowPlaying.title')}</SectionLabel>
					<NowPlaying />
				</section>

				<section className="space-y-4">
					<SectionLabel>{t('system.title')}</SectionLabel>
					{serverless ? (
						<RefreshLiveState lastSeenAt={lastSeenAt} />
					) : (
						<>
							<Suspense
								fallback={
									<div className="animate-pulse text-sm text-muted-foreground">
										{t('system.loading')}
									</div>
								}
							>
								<SystemStatsChart />
							</Suspense>
							<MonitoringPanel />
						</>
					)}
				</section>
			</div>
		</main>
	)
}
