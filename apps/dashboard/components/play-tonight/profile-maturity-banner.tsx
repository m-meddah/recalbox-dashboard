'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useState } from 'react'

export function ProfileMaturityBanner() {
	const t = useTranslations('playTonight.maturityBanner')
	const [maturity, setMaturity] = useState<number | null>(null)

	useEffect(() => {
		fetch('/api/profile')
			.then((r) => r.json())
			.then((d) => setMaturity(d.profileMaturity))
	}, [])

	if (maturity === null || maturity >= 0.5) return null
	const pct = Math.round(maturity * 100)

	return (
		<Card className="border-amber-500/30 bg-amber-500/5">
			<CardContent className="py-3 flex items-center gap-3 text-sm">
				<Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
				<p className="flex-1">
					{t.rich('message', {
						pct,
						b: (chunks) => <span className="font-medium">{chunks}</span>,
					})}{' '}
					<Link href="/profile" className="text-primary underline">
						{t('details')}
					</Link>
				</p>
			</CardContent>
		</Card>
	)
}
