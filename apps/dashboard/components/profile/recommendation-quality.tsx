'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { QualityMetrics } from '@/lib/recommendations/quality-metrics'
import { useEffect, useState } from 'react'

function pct(v: number) {
	return `${Math.round(v * 100)}%`
}

export function RecommendationQuality() {
	const [metrics, setMetrics] = useState<QualityMetrics | null>(null)
	const [days, setDays] = useState(30)

	useEffect(() => {
		fetch(`/api/recommendations/metrics?days=${days}`)
			.then((r) => r.json())
			.then(setMetrics)
	}, [days])

	if (!metrics) return null

	if (metrics.totalRecommendations === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Qualité des recommandations</CardTitle>
				</CardHeader>
				<CardContent className="text-sm text-muted-foreground">
					Pas encore de données. Utilise &quot;Que jouer ce soir ?&quot; et lance quelques jeux
					recommandés, les métriques apparaîtront ici.
				</CardContent>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="text-base">Qualité des recommandations</CardTitle>
					<select
						value={days}
						onChange={(e) => setDays(Number(e.target.value))}
						className="text-xs border rounded px-2 py-1 bg-background"
					>
						<option value={7}>7 jours</option>
						<option value={30}>30 jours</option>
						<option value={90}>90 jours</option>
						<option value={365}>1 an</option>
					</select>
				</div>
			</CardHeader>
			<CardContent className="space-y-5">
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
					<Kpi label="Recos" value={metrics.totalRecommendations} />
					<Kpi label="Lancées" value={pct(metrics.launchRate)} sub={`${metrics.totalLaunched}`} />
					<Kpi
						label="Accroché"
						value={pct(metrics.hitRate)}
						sub="sessions significatives"
						hint={metrics.hitRate >= 0.5 ? 'good' : metrics.hitRate >= 0.3 ? 'ok' : 'low'}
					/>
					<Kpi label="Passées" value={pct(metrics.skipRate)} sub={`${metrics.totalSkipped}`} />
				</div>

				<div className="space-y-1">
					<div className="flex justify-between text-sm">
						<span>Taux de &quot;bounce&quot; après lancement</span>
						<span className="font-medium">{pct(metrics.bounceRate)}</span>
					</div>
					<Progress value={metrics.bounceRate * 100} />
					<p className="text-xs text-muted-foreground">
						Quand tu lances une reco, % où tu quittes en moins de 10 min. Idéalement &lt; 20%.
					</p>
				</div>

				<div className="space-y-2">
					<p className="text-sm font-medium">Par niveau de confiance</p>
					<table className="w-full text-sm">
						<thead className="text-xs text-muted-foreground border-b">
							<tr>
								<th className="text-left py-1.5">Confiance</th>
								<th className="text-right">Total</th>
								<th className="text-right">Lancées</th>
								<th className="text-right">Accroché</th>
							</tr>
						</thead>
						<tbody>
							{(['high', 'medium', 'exploration'] as const).map((c) => {
								const d = metrics.byConfidence[c]
								if (!d || d.total === 0) return null
								const label = c === 'high' ? 'Forte' : c === 'medium' ? 'Moyenne' : 'Découverte'
								return (
									<tr key={c} className="border-b last:border-0">
										<td className="py-1.5">{label}</td>
										<td className="text-right">{d.total}</td>
										<td className="text-right">{pct(d.launchRate)}</td>
										<td className="text-right">{pct(d.hitRate)}</td>
									</tr>
								)
							})}
						</tbody>
					</table>
					<p className="text-xs text-muted-foreground">
						Idéalement le taux &quot;accroché&quot; décroît : Forte &gt; Moyenne &gt; Découverte.
					</p>
				</div>

				{Object.keys(metrics.byMood).length > 0 && (
					<div className="space-y-2">
						<p className="text-sm font-medium">Par humeur</p>
						<table className="w-full text-sm">
							<thead className="text-xs text-muted-foreground border-b">
								<tr>
									<th className="text-left py-1.5">Humeur</th>
									<th className="text-right">Total</th>
									<th className="text-right">Lancées</th>
									<th className="text-right">Accroché</th>
								</tr>
							</thead>
							<tbody>
								{Object.entries(metrics.byMood).map(([mood, d]) => (
									<tr key={mood} className="border-b last:border-0">
										<td className="py-1.5 capitalize">{mood}</td>
										<td className="text-right">{d.total}</td>
										<td className="text-right">{pct(d.launchRate)}</td>
										<td className="text-right">{pct(d.hitRate)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

function Kpi({
	label,
	value,
	sub,
	hint,
}: {
	label: string
	value: string | number
	sub?: string
	hint?: 'good' | 'ok' | 'low'
}) {
	const color =
		hint === 'good'
			? 'text-green-600 dark:text-green-400'
			: hint === 'low'
				? 'text-orange-600 dark:text-orange-400'
				: ''
	return (
		<div className="space-y-0.5">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className={`text-xl font-bold ${color}`}>{value}</p>
			{sub && <p className="text-xs text-muted-foreground">{sub}</p>}
		</div>
	)
}
