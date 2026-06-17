import { OverclockPanel } from '@/components/config/overclock-panel'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { type OverclockInfo, readOverclockInfo } from '@/lib/recalbox/overclock'
import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

const UNSUPPORTED: OverclockInfo = {
	supported: false,
	modelName: null,
	board: null,
	profilesDir: null,
	available: [],
	current: null,
	temp: null,
	throttle: null,
}

type Props = {
	params: Promise<{ locale: string }>
}

export default async function PerformancePage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	const [t, recalboxId] = await Promise.all([getTranslations('config'), getActiveRecalboxId()])
	const info = recalboxId ? await readOverclockInfo(recalboxId) : UNSUPPORTED

	return (
		<div className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
			<div className="space-y-3">
				<Link href="/configuration" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
					<ArrowLeft className="size-4" />
					{t('back')}
				</Link>
				<div>
					<h1 className="text-2xl font-bold">{t('performance.title')}</h1>
					<p className="text-muted-foreground text-sm">{t('performance.subtitle')}</p>
				</div>
			</div>

			<OverclockPanel info={info} />
		</div>
	)
}
