import { getViewableRecalboxIds } from '@/lib/auth/ownership'
import { getUser } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { getSessionStats } from '@/lib/db/queries'
import { formatDuration } from '@/lib/stats/formatters'
import { getTranslations } from 'next-intl/server'

export const dynamic = 'force-dynamic'

export default async function AllRecalboxesPage() {
	const t = await getTranslations('recalboxes')
	const user = await getUser()
	const viewable = user ? new Set(getViewableRecalboxIds(user)) : new Set<string>()
	const all = configStore.getRecalboxes().filter((r) => !r.archived && viewable.has(r.id))

	const statsPerRb = await Promise.all(
		all.map(async (rb) => {
			const stats = await getSessionStats({ recalboxId: rb.id })
			return { rb, stats }
		}),
	)

	const totalPlaytime = statsPerRb.reduce((sum, { stats }) => sum + stats.totalPlaytimeSec, 0)
	const totalSessions = statsPerRb.reduce((sum, { stats }) => sum + stats.totalSessions, 0)

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
			<h1 className="text-2xl font-bold">{t('allPage.title')}</h1>
			<div className="grid grid-cols-2 md:grid-cols-3 gap-4">
				<div className="border rounded p-4">
					<p className="text-xs text-muted-foreground">{t('allPage.totalPlaytime')}</p>
					<p className="text-xl font-bold">{formatDuration(totalPlaytime)}</p>
				</div>
				<div className="border rounded p-4">
					<p className="text-xs text-muted-foreground">{t('allPage.totalSessions')}</p>
					<p className="text-xl font-bold">{totalSessions}</p>
				</div>
				<div className="border rounded p-4">
					<p className="text-xs text-muted-foreground">{t('allPage.recalboxes')}</p>
					<p className="text-xl font-bold">{all.length}</p>
				</div>
			</div>
			<div className="space-y-4">
				{statsPerRb.map(({ rb, stats }) => (
					<div key={rb.id} className="border rounded p-4 space-y-1">
						<p className="font-medium">
							{rb.iconEmoji ?? '🕹️'} {rb.name}
						</p>
						<div className="text-sm text-muted-foreground flex gap-4">
							<span>{formatDuration(stats.totalPlaytimeSec)}</span>
							<span>{stats.totalSessions} sessions</span>
							<span>{stats.uniqueGames} games</span>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
