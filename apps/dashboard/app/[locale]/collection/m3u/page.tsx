import { M3uCandidates } from '@/components/m3u-candidates'
import { Separator } from '@/components/ui/separator'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { ChevronRight } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ locale: string }> }

export default async function M3uPage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])
	const t = await getTranslations('m3u')

	return (
		<div className="container mx-auto max-w-6xl space-y-6 px-4 py-8">
			<nav className="flex items-center gap-1 text-sm text-muted-foreground">
				<Link href="/collection" className="hover:text-foreground">
					{t('breadcrumb')}
				</Link>
				<ChevronRight className="size-4" />
				<span className="font-medium text-foreground">{t('title')}</span>
			</nav>

			<div>
				<h1 className="text-2xl font-bold">{t('title')}</h1>
			</div>

			<Separator />

			<M3uCandidates />
		</div>
	)
}
