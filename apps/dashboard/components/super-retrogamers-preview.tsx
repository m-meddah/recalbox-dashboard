'use client'

import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { SrGame } from '@/lib/super-retrogamers/client'
import { ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type State =
	| { status: 'loading' }
	| { status: 'not-found' }
	| { status: 'error' }
	| { status: 'loaded'; game: SrGame & { stale?: boolean } }

type Props = {
	slug: string | null
}

export function SuperRetrogamersPreview({ slug }: Props) {
	const t = useTranslations('superRetrogamers.preview')
	const [state, setState] = useState<State>({ status: 'loading' })

	useEffect(() => {
		if (!slug) {
			setState({ status: 'not-found' })
			return
		}
		setState({ status: 'loading' })
		fetch(`/api/super-retrogamers/games/${encodeURIComponent(slug)}`)
			.then((r) => r.json())
			.then((data: SrGame | null) => {
				if (data) setState({ status: 'loaded', game: data })
				else setState({ status: 'not-found' })
			})
			.catch(() => setState({ status: 'error' }))
	}, [slug])

	if (state.status === 'loading') {
		return (
			<div className="space-y-3 p-4">
				<Skeleton className="h-6 w-1/3" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-4/5" />
			</div>
		)
	}

	if (state.status === 'not-found') {
		return (
			<div className="p-4 text-center text-sm text-muted-foreground">{t('notFound')}</div>
		)
	}

	if (state.status === 'error') {
		return (
			<div className="space-y-2 p-4 text-center">
				<p className="text-sm text-destructive">{t('error')}</p>
				<Button variant="outline" size="sm" onClick={() => setState({ status: 'loading' })}>
					{t('retry')}
				</Button>
			</div>
		)
	}

	const { game } = state
	return (
		<div className="space-y-4 p-4">
			{game.stale && <p className="text-xs text-muted-foreground">{t('stale')}</p>}
			{game.score !== null && (
				<div className="flex items-center gap-2">
					<span className="text-2xl font-bold">{game.score}</span>
					<span className="text-sm text-muted-foreground">/100</span>
				</div>
			)}
			{game.summary && (
				<p className="text-sm leading-relaxed text-muted-foreground">{game.summary}</p>
			)}
			{Object.keys(game.specs).length > 0 && (
				<div className="grid grid-cols-2 gap-1 text-xs">
					{Object.entries(game.specs).map(([k, v]) => (
						<div key={k} className="flex gap-1">
							<span className="capitalize text-muted-foreground">{k}:</span>
							<span>{v}</span>
						</div>
					))}
				</div>
			)}
			{game.characters.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{game.characters.map((c) => (
						<span key={c} className="rounded bg-muted px-1.5 py-0.5 text-xs">
							{c}
						</span>
					))}
				</div>
			)}
			<a
				href={game.url}
				target="_blank"
				rel="noopener noreferrer"
				className={buttonVariants({ variant: 'outline', size: 'sm' })}
			>
				{t('readFull')}
				<ExternalLink className="ml-1.5 h-3.5 w-3.5" />
			</a>
		</div>
	)
}
