import { Suspense } from 'react'
import { SystemStatsChart } from '@/components/system-stats-chart'

export default function Home() {
	return (
		<main className="p-8">
			<h1 className="text-2xl font-bold mb-6">Recalbox Dashboard</h1>
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
				{/* Left column — Now Playing (Ticket 2) */}
				<section>
					<h2 className="text-lg font-semibold mb-4 text-muted-foreground">Now Playing</h2>
					<div className="rounded-lg border border-dashed border-muted p-12 text-center text-sm text-muted-foreground">
						À venir — Ticket 2 (MQTT)
					</div>
				</section>

				{/* Right column — System stats */}
				<section>
					<h2 className="text-lg font-semibold mb-4 text-muted-foreground">Système</h2>
					<Suspense
						fallback={
							<div className="text-sm text-muted-foreground animate-pulse">Chargement…</div>
						}
					>
						<SystemStatsChart />
					</Suspense>
				</section>
			</div>
		</main>
	)
}
