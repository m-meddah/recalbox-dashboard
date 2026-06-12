import { ConfigSectionForm } from '@/components/config/config-section-form'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { CONFIG_SECTIONS } from '@/lib/recalbox/config-schema'
import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ locale: string; section: string }>
}

export default async function ConfigSectionPage({ params }: Props) {
	const { locale, section } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	const meta = CONFIG_SECTIONS.find((s) => s.id === section)
	if (!meta) notFound()

	const t = await getTranslations('config')

	return (
		<div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
			<div className="space-y-3">
				<Link href="/configuration" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
					<ArrowLeft className="size-4" />
					{t('back')}
				</Link>
				<div>
					<h1 className="text-2xl font-bold">{t(`sections.${meta.id}.title`)}</h1>
					<p className="text-muted-foreground text-sm">{t(`sections.${meta.id}.desc`)}</p>
				</div>
			</div>

			<ConfigSectionForm
				section={meta.id}
				risky={meta.risky}
				requiresEsRestart={meta.requiresEsRestart}
			/>
		</div>
	)
}
