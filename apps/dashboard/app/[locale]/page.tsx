import { NowPlaying } from '@/components/now-playing'
import { SystemStatsChart } from '@/components/system-stats-chart'
import type { routing } from '@/i18n/routing'
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

	return (
		<main className="p-4 sm:p-8">
			<h1 className="text-2xl font-bold mb-6">Recalbox Dashboard</h1>
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
				<section>
					<h2 className="text-lg font-semibold mb-4 text-muted-foreground">
						{t('nowPlaying.title')}
					</h2>
					<NowPlaying />
				</section>

				<section>
					<h2 className="text-lg font-semibold mb-4 text-muted-foreground">{t('system.title')}</h2>
					<Suspense
						fallback={
							<div className="text-sm text-muted-foreground animate-pulse">
								{t('system.loading')}
							</div>
						}
					>
						<SystemStatsChart />
					</Suspense>
				</section>
			</div>
		</main>
	)
}
