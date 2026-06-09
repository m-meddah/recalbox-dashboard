import { isAdmin } from '@/lib/auth/ownership'
import { getUser } from '@/lib/auth/require-user'
import { getAdminOverview } from '@/lib/db/admin-queries'
import { formatDuration } from '@/lib/stats/formatters'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
	const user = await getUser()
	if (!user || !isAdmin(user)) redirect('/')

	const t = await getTranslations('admin')
	const overview = await getAdminOverview()

	const cards = [
		...overview.users.map((u) => ({
			key: u.user.id,
			title: u.user.email,
			role: u.user.role,
			machines: u.machines,
			stats: u.stats,
		})),
		...(overview.unassigned
			? [
					{
						key: '__unassigned__',
						title: t('unassigned'),
						role: null,
						machines: overview.unassigned.machines,
						stats: overview.unassigned.stats,
					},
				]
			: []),
	]

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
			<div>
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<p className="text-sm text-muted-foreground">{t('subtitle')}</p>
			</div>

			{overview.users.length === 0 && (
				<p className="text-sm text-muted-foreground">{t('noUsers')}</p>
			)}

			<div className="space-y-4">
				{cards.map((c) => (
					<div key={c.key} className="border rounded-lg p-4 space-y-3">
						<div className="flex items-center gap-2">
							<p className="font-medium">{c.title}</p>
							{c.role && (
								<span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
									{c.role}
								</span>
							)}
						</div>

						<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
							<div>
								<p className="text-xs text-muted-foreground">{t('playtime')}</p>
								<p className="font-semibold">{formatDuration(c.stats.totalPlaytimeSec)}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">{t('sessions')}</p>
								<p className="font-semibold">{c.stats.totalSessions}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">{t('games')}</p>
								<p className="font-semibold">{c.stats.uniqueGames}</p>
							</div>
							<div>
								<p className="text-xs text-muted-foreground">{t('machines')}</p>
								<p className="font-semibold">{c.machines.length}</p>
							</div>
						</div>

						{c.machines.length > 0 && (
							<div className="flex flex-wrap gap-2">
								{c.machines.map((m) => (
									<span
										key={m.id}
										className="rounded border px-2 py-1 text-xs text-muted-foreground"
									>
										{m.iconEmoji ?? '🕹️'} {m.name}
										{m.archived ? ` (${t('archived')})` : ''}
									</span>
								))}
							</div>
						)}

						{c.stats.topGames.length > 0 ? (
							<div className="space-y-1">
								<p className="text-xs text-muted-foreground">{t('topGames')}</p>
								<ol className="space-y-0.5 text-sm">
									{c.stats.topGames.slice(0, 5).map((g) => (
										<li key={g.romPath} className="flex justify-between gap-4">
											<span className="truncate">{g.gameName}</span>
											<span className="shrink-0 text-muted-foreground">
												{formatDuration(g.playtimeSec)}
											</span>
										</li>
									))}
								</ol>
							</div>
						) : (
							<p className="text-xs text-muted-foreground">{t('noActivity')}</p>
						)}
					</div>
				))}
			</div>
		</div>
	)
}
