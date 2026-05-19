import { routing } from '@/i18n/routing'
import { WifiOff } from 'lucide-react'
import { hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { RetryButton } from './_components/retry-button'

type Props = { params: Promise<{ locale: string }> }

export const dynamic = 'force-static'

export async function generateStaticParams() {
	return routing.locales.map((locale) => ({ locale }))
}

export default async function OfflinePage({ params }: Props) {
	const { locale } = await params
	if (!hasLocale(routing.locales, locale)) notFound()
	setRequestLocale(locale)
	const t = await getTranslations('offline')

	return (
		<div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center">
			<WifiOff className="h-16 w-16 text-muted-foreground" />
			<div className="space-y-2">
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<p className="text-muted-foreground max-w-sm">{t('description')}</p>
			</div>
			<RetryButton label={t('retry')} />
		</div>
	)
}
