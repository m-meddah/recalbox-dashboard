import { db } from '@/lib/db/index'
import { sessions, wrappedCache } from '@/lib/db/schema'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { Link } from '@/i18n/navigation'
import { sql, desc } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ locale: string }> }

async function getAvailableYears(locale: string) {
	const currentYear = new Date().getFullYear()
	const currentMonth = new Date().getMonth() + 1

	const yearRows = db
		.select({
			year: sql<number>`strftime('%Y', datetime(${sessions.startedAt}, 'unixepoch'))`,
			sessionCount: sql<number>`COUNT(*)`,
		})
		.from(sessions)
		.where(sql`${sessions.endedAt} IS NOT NULL`)
		.groupBy(sql`strftime('%Y', datetime(${sessions.startedAt}, 'unixepoch'))`)
		.orderBy(desc(sql`strftime('%Y', datetime(${sessions.startedAt}, 'unixepoch'))`))
		.all()

	const cacheRows = db.select().from(wrappedCache).all()
	const cacheByYear = Object.fromEntries(cacheRows.map((r) => [`${r.year}-${r.locale}`, r]))

	return yearRows
		.filter((r) => {
			const year = Number(r.year)
			if (r.sessionCount === 0) return false
			if (year < currentYear) return true
			return currentMonth >= 12
		})
		.map((r) => {
			const year = Number(r.year)
			const cached = cacheByYear[`${year}-${locale}`]
			return {
				year,
				sessionCount: r.sessionCount,
				generatedAt: cached ? new Date(cached.generatedAt) : null,
				totalHours: cached
					? Math.floor(
							(JSON.parse(cached.data) as { slides: Array<{ type: string; totalHours?: number }> })
								.slides.find((s) => s.type === 'total-time')?.totalHours ?? 0,
						)
					: null,
			}
		})
}

export default async function WrappedArchivePage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])
	const t = await getTranslations('wrapped.archive')
	const years = await getAvailableYears(locale)

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-sm px-4 py-8">
				<div className="mb-6 flex items-center gap-3">
					<Link href="/stats" className="text-white/50 hover:text-white">
						<ArrowLeft className="h-5 w-5" />
					</Link>
					<h1 className="text-2xl font-black text-white">{t('title')}</h1>
				</div>

				{years.length === 0 && (
					<p className="text-center text-white/40 mt-12">No wrapped years yet.</p>
				)}

				<div className="space-y-3">
					{years.map((y) => (
						<div
							key={y.year}
							className="rounded-2xl border border-white/10 bg-white/5 p-4 flex items-center justify-between"
						>
							<div>
								<p className="text-2xl font-black text-white">{y.year}</p>
								{y.totalHours !== null && (
									<p className="text-sm text-white/60">{t('hoursPlayed', { hours: y.totalHours })}</p>
								)}
								{y.generatedAt && (
									<p className="text-xs text-white/30 mt-0.5">
										{t('generatedOn', { date: y.generatedAt.toLocaleDateString(locale) })}
									</p>
								)}
							</div>
							<Link
								href={`/wrapped/${y.year}`}
								className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-black"
							>
								{t('view')}
							</Link>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
