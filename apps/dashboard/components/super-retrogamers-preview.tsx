'use client'

import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { SrGame } from '@/lib/super-retrogamers/client'
import { ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type FetchedState =
	| { status: 'not-found'; forSlug: string }
	| { status: 'error'; forSlug: string }
	| { status: 'loaded'; game: SrGame & { stale?: boolean }; forSlug: string }

type Props = {
	slug: string | null
}

export function SuperRetrogamersPreview({ slug }: Props) {
	const t = useTranslations('superRetrogamers.preview')
	const [fetched, setFetched] = useState<FetchedState | null>(null)
	const [retryCount, setRetryCount] = useState(0)

	// biome-ignore lint/correctness/useExhaustiveDependencies: retryCount is an intentional refetch trigger
	useEffect(() => {
		if (!slug) return
		fetch(`/api/super-retrogamers/games/${encodeURIComponent(slug)}`)
			.then((r) => r.json())
			.then((data: SrGame | null) => {
				if (data) setFetched({ status: 'loaded', game: data, forSlug: slug })
				else setFetched({ status: 'not-found', forSlug: slug })
			})
			.catch(() => setFetched({ status: 'error', forSlug: slug }))
	}, [slug, retryCount])

	const status = !slug ? 'not-found' : fetched?.forSlug === slug ? fetched.status : 'loading'

	if (status === 'loading') {
		return (
			<div className="space-y-3 p-4">
				<Skeleton className="h-6 w-1/3" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-4/5" />
			</div>
		)
	}

	if (status === 'not-found') {
		return <div className="p-4 text-center text-sm text-muted-foreground">{t('notFound')}</div>
	}

	if (status === 'error') {
		return (
			<div className="space-y-2 p-4 text-center">
				<p className="text-sm text-destructive">{t('error')}</p>
				<Button variant="outline" size="sm" onClick={() => setRetryCount((c) => c + 1)}>
					{t('retry')}
				</Button>
			</div>
		)
	}

	const { game } = fetched as {
		status: 'loaded'
		game: SrGame & { stale?: boolean }
		forSlug: string
	}
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
				<ExternalLink className="ml-1.5 size-3.5" />
			</a>
		</div>
	)
}
