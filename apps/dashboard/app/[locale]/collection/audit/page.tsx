import { AuditOverview } from '@/components/rom-audit/audit-overview'
import { AuditSystemDetail } from '@/components/rom-audit/audit-system-detail'
import { ScanButton } from '@/components/rom-audit/scan-button'
import { buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { systemOverviews } from '@/lib/rom-audit/read-service'
import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = {
	params: Promise<{ locale: string }>
	searchParams: Promise<{ system?: string }>
}

export default async function RomAuditPage({ params, searchParams }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])

	const [{ system }, recalboxId, t] = await Promise.all([
		searchParams,
		getActiveRecalboxId(),
		getTranslations('romAudit'),
	])

	// Reads the aggregate table only — one row per system, whatever the size of
	// the collection behind it.
	const systems = recalboxId ? await systemOverviews(recalboxId) : []
	const selected = system ? systems.find((s) => s.system === system) : undefined

	return (
		<div className="container mx-auto max-w-6xl space-y-6 px-4 py-8">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-bold text-2xl">{t('title')}</h1>
					<p className="text-muted-foreground text-sm">
						{systems.length > 0 ? t('subtitle', { systems: systems.length }) : t('empty.subtitle')}
					</p>
				</div>
				<div className="flex flex-wrap items-start gap-2">
					<Link href="/collection" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
						<ArrowLeft className="mr-2 size-4" />
						{t('backToCollection')}
					</Link>
					{recalboxId && <ScanButton recalboxId={recalboxId} />}
				</div>
			</div>

			<Separator />

			{!recalboxId && <p className="text-muted-foreground text-sm">{t('empty.noRecalbox')}</p>}

			{recalboxId && systems.length === 0 && (
				<div className="rounded-md border border-dashed p-6 text-center">
					<p className="font-medium">{t('empty.title')}</p>
					<p className="mt-1 text-muted-foreground text-sm">{t('empty.body')}</p>
				</div>
			)}

			{recalboxId && selected && (
				<section className="space-y-4">
					<div className="flex items-baseline justify-between gap-2">
						<h2 className="font-semibold text-xl">{selected.system}</h2>
						<Link href="/collection/audit" className="text-primary text-sm hover:underline">
							{t('detail.backToOverview')}
						</Link>
					</div>
					<AuditSystemDetail
						recalboxId={recalboxId}
						system={selected.system}
						regions={['Europe', 'USA', 'Japan', 'World']}
					/>
				</section>
			)}

			{recalboxId && !selected && systems.length > 0 && <AuditOverview systems={systems} />}
		</div>
	)
}
