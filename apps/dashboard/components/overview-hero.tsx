import { StatCircle } from '@/components/stat-circle'
import { getCollectionStats } from '@/lib/db/queries'
import { getTranslations } from 'next-intl/server'

/**
 * "APERÇU" banner inspired by the Recalbox Web Manager home page:
 * navy→teal gradient header with the gamepad pattern + brand logo, then a row
 * of circular collection stats.
 */
export async function OverviewHero() {
	const t = await getTranslations('dashboard.overview')
	const stats = await getCollectionStats()

	const systems = Object.keys(stats.bySystem).length
	const games = stats.totalGames
	const playedPct = games > 0 ? Math.round(((games - stats.neverPlayed) / games) * 100) : 0

	return (
		<section className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
			<div
				className="relative flex h-20 items-center justify-between px-6"
				style={{
					backgroundImage:
						'url(/recalbox/gamepad-pattern.png), linear-gradient(to right, #34495e, #85d6de)',
					backgroundRepeat: 'repeat, no-repeat',
					backgroundSize: 'auto, cover',
				}}
			>
				<h1 className="text-xl font-semibold tracking-[0.18em] text-white/95 uppercase">
					{t('title')}
				</h1>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src="/recalbox/recalbox-logo.svg" alt="Recalbox" className="h-7 brightness-0 invert" />
			</div>
			<div className="grid grid-cols-1 gap-6 px-6 py-8 sm:grid-cols-3">
				<StatCircle value={systems} label={t('systems')} />
				<StatCircle value={games} label={t('games')} />
				<StatCircle value={`${playedPct}%`} label={t('played')} percent={playedPct} />
			</div>
		</section>
	)
}
