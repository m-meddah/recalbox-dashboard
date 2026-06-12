import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { CONFIG_SECTIONS } from '@/lib/recalbox/config-schema'
import { ChevronRight } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ locale: string }>
}

export default async function ConfigurationIndexPage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])
	const t = await getTranslations('config')

	return (
		<div className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
			<div>
				<h1 className="text-2xl font-bold">{t('title')}</h1>
				<p className="text-muted-foreground text-sm">{t('subtitle')}</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				{CONFIG_SECTIONS.map((s) => (
					<Link key={s.id} href={`/configuration/${s.id}`}>
						<Card className="hover:border-primary/50 transition-colors">
							<CardHeader className="flex-row items-center justify-between gap-2">
								<div className="space-y-1">
									<CardTitle className="text-base">{t(`sections.${s.id}.title`)}</CardTitle>
									<CardDescription>{t(`sections.${s.id}.desc`)}</CardDescription>
								</div>
								<ChevronRight className="text-muted-foreground size-5 shrink-0" />
							</CardHeader>
						</Card>
					</Link>
				))}

				<Link href="/configuration/systems">
					<Card className="hover:border-primary/50 transition-colors">
						<CardHeader className="flex-row items-center justify-between gap-2">
							<div className="space-y-1">
								<CardTitle className="text-base">{t('systems.title')}</CardTitle>
								<CardDescription>{t('systems.subtitle')}</CardDescription>
							</div>
							<ChevronRight className="text-muted-foreground size-5 shrink-0" />
						</CardHeader>
					</Card>
				</Link>
			</div>
		</div>
	)
}
