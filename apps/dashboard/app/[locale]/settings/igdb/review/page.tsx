'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Check, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type ReviewItem = {
	gameId: number
	gameName: string
	system: string
	igdbId: number | null
	igdbName: string | null
	confidence: number | null
	method: string | null
}

export default function IgdbReviewPage() {
	const router = useRouter()
	const [items, setItems] = useState<ReviewItem[]>([])
	const [loading, setLoading] = useState(true)
	const [acting, setActing] = useState<number | null>(null)

	useEffect(() => {
		fetch('/api/igdb/review')
			.then((r) => r.json())
			.then((data: { items: ReviewItem[] }) => {
				setItems(data.items)
				setLoading(false)
			})
			.catch(() => setLoading(false))
	}, [])

	async function handleAction(gameId: number, action: 'confirm' | 'reject') {
		setActing(gameId)
		await fetch('/api/igdb/review/confirm', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ gameId, action }),
		})
		setItems((prev) => prev.filter((item) => item.gameId !== gameId))
		setActing(null)
	}

	return (
		<div className="container max-w-4xl mx-auto p-6 space-y-6">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="sm" onClick={() => router.back()}>
					<ArrowLeft className="w-4 h-4 mr-1" />
					Retour
				</Button>
				<div>
					<h1 className="text-2xl font-bold">Vérification des matchs IGDB</h1>
					<p className="text-sm text-muted-foreground">
						Ces matchs ont une confiance faible. Confirmez ou rejetez-les.
					</p>
				</div>
			</div>

			{loading && <p className="text-muted-foreground text-sm">Chargement…</p>}

			{!loading && items.length === 0 && (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground text-sm">
						Aucun match à vérifier. Tout est en ordre.
					</CardContent>
				</Card>
			)}

			{!loading && items.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>{items.length} match{items.length > 1 ? 'es' : ''} à vérifier</CardTitle>
					</CardHeader>
					<CardContent className="p-0">
						<div className="divide-y">
							{items.map((item) => (
								<div
									key={item.gameId}
									className="flex items-center gap-3 px-4 py-3 text-sm"
								>
									<div className="flex-1 min-w-0">
										<p className="font-medium truncate">{item.gameName}</p>
										<p className="text-xs text-muted-foreground">{item.system}</p>
									</div>
									<div className="flex-1 min-w-0 text-muted-foreground">
										<p className="truncate">{item.igdbName ?? '—'}</p>
										<p className="text-xs">
											{item.confidence != null
												? `${Math.round(item.confidence * 100)}% (${item.method})`
												: '—'}
										</p>
									</div>
									<div className="flex gap-2 shrink-0">
										<Button
											size="sm"
											variant="outline"
											className="text-green-600 border-green-200 hover:bg-green-50"
											disabled={acting === item.gameId}
											onClick={() => handleAction(item.gameId, 'confirm')}
										>
											<Check className="w-3.5 h-3.5" />
										</Button>
										<Button
											size="sm"
											variant="outline"
											className="text-red-600 border-red-200 hover:bg-red-50"
											disabled={acting === item.gameId}
											onClick={() => handleAction(item.gameId, 'reject')}
										>
											<X className="w-3.5 h-3.5" />
										</Button>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
