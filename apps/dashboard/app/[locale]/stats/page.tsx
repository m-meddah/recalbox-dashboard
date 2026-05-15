import { routing } from '@/i18n/routing'
import { redirect } from '@/i18n/navigation'
import { setRequestLocale } from 'next-intl/server'

type Props = {
	params: Promise<{ locale: string }>
}

export default async function StatsPage({ params }: Props) {
	const { locale } = await params
	const typedLocale = locale as (typeof routing.locales)[number]
	setRequestLocale(typedLocale)
	redirect({ href: '/stats/week', locale: typedLocale })
}
