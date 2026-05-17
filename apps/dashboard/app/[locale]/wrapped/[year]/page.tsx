import { getCachedWrapped } from '@/lib/wrapped/cache'
import { routing } from '@/i18n/routing'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { StoryViewer } from '@/components/wrapped/story-viewer'
import { notFound } from 'next/navigation'

type Props = { params: Promise<{ year: string; locale: string }> }

export const dynamic = 'force-dynamic'

export default async function WrappedYearPage({ params }: Props) {
	const { year: yearStr, locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	const year = parseInt(yearStr, 10)
	if (isNaN(year) || year < 2000 || year > new Date().getFullYear() + 1) {
		notFound()
	}

	const t = await getTranslations('wrapped')
	const wrapped = await getCachedWrapped(year, locale)

	if (!wrapped || wrapped.slides.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-4 text-center p-6">
				<span className="text-5xl">🎮</span>
				<h1 className="text-2xl font-black text-white">{t('noData.title', { year })}</h1>
				<p className="text-white/50">{t('noData.subtitle')}</p>
				<Link href="/stats" className="rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-black">
					{t('noData.cta')}
				</Link>
			</div>
		)
	}

	return <StoryViewer wrapped={wrapped} year={year} locale={locale} />
}
