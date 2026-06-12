import { SystemsCatalog } from '@/components/config/systems-catalog'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { configStore } from '@/lib/config-store'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { readSystemEmulatorOverrides } from '@/lib/recalbox/system-emulator'
import { fetchSystemsCatalog } from '@/lib/recalbox/web-config'
import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ locale: string }>
}

export default async function SystemsCatalogPage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	// `t` and the active recalbox are independent — resolve them together.
	const [t, recalboxId] = await Promise.all([getTranslations('config'), getActiveRecalboxId()])

	// Load on the server and hand the data to the client component as props —
	// no client-side fetch-in-effect needed.
	const host = recalboxId ? (configStore.getRecalbox(recalboxId)?.host ?? null) : null
	const [systems, overrides] = await Promise.all([
		host ? fetchSystemsCatalog(host) : Promise.resolve([]),
		recalboxId ? readSystemEmulatorOverrides(recalboxId) : Promise.resolve({}),
	])

	return (
		<div className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
			<div className="space-y-3">
				<Link href="/configuration" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
					<ArrowLeft className="size-4" />
					{t('back')}
				</Link>
				<div>
					<h1 className="text-2xl font-bold">{t('systems.title')}</h1>
					<p className="text-muted-foreground text-sm">{t('systems.subtitle')}</p>
				</div>
			</div>

			<SystemsCatalog systems={systems} overrides={overrides} />
		</div>
	)
}
