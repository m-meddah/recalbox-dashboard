import { BiosTable } from '@/components/bios-table'
import type { routing } from '@/i18n/routing'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ locale: string }>
}

export default async function BiosPage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])
	const t = await getTranslations('bios')

	return (
		<div className="container mx-auto max-w-6xl space-y-6 px-4 py-8">
			<div>
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<p className="text-sm text-muted-foreground">{t('subtitle')}</p>
			</div>
			<BiosTable />
		</div>
	)
}
