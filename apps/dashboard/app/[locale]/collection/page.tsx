import { CollectionHealthPanel } from '@/components/collection-health-panel'
import { SyncButton } from '@/components/sync-button'
import { SystemGrid } from '@/components/system-grid'
import { buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { getCollectionHealth } from '@/lib/collection-health'
import { getCollectionStats } from '@/lib/db/queries'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getPatronStatus } from '@/lib/recalbox/patron-status'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { Disc3 } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ locale: string }>
}

export default async function CollectionPage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	const recalboxId = await getActiveRecalboxId()

	const [stats, t, health, patron] = await Promise.all([
		getCollectionStats(),
		getTranslations('collection'),
		getCollectionHealth(recalboxId ?? undefined),
		recalboxId
			? getPatronStatus(getSshClient(recalboxId))
			: Promise.resolve({ isPatron: false, keyPresent: false, keyLooksValid: false }),
	])

	// All systems that have at least one rom, alphabetical like the Web Manager.
	const systems = Object.entries(stats.bySystem)
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => a.name.localeCompare(b.name))

	return (
		<div className="container mx-auto max-w-6xl space-y-6 px-4 py-8">
			{/* Header */}
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold">{t('title')}</h1>
					<p className="text-sm text-muted-foreground">
						{t('gamesCount', { count: stats.totalGames })} ·{' '}
						{t('favoritesCount', { count: stats.favorites })} ·{' '}
						{t('neverPlayedCount', { count: stats.neverPlayed })} ·{' '}
						{t('systemsCount', { count: systems.length })}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Link
						href="/collection/m3u"
						className={buttonVariants({ variant: 'outline', size: 'sm' })}
					>
						<Disc3 className="mr-2 size-4" />
						Multi-disc / .m3u
					</Link>
					<SyncButton />
				</div>
			</div>

			<Separator />

			{/* Collection health panel */}
			<CollectionHealthPanel health={health} patron={patron} />

			{/* System grid */}
			<SystemGrid systems={systems} />
		</div>
	)
}
