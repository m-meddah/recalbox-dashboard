import { type SshConfFieldDef, SshConfForm } from '@/components/config/ssh-conf-form'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { loadConfSectionValues } from '@/lib/recalbox/conf-section-load'
import { ES_COLLECTIONS_SPECS } from '@/lib/recalbox/conf-sections'
import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ locale: string }> }

export default async function CollectionsPage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])
	const t = await getTranslations('config')
	const initial = await loadConfSectionValues(ES_COLLECTIONS_SPECS)

	const fields: SshConfFieldDef[] = [
		{
			key: 'emulationstation.arcade',
			type: 'boolean',
			label: t('esCollections.fields.arcade'),
			description: t('esCollections.fields.arcadeDesc'),
		},
		{
			key: 'emulationstation.arcade.includeneogeo',
			type: 'boolean',
			label: t('esCollections.fields.includeNeogeo'),
		},
		{
			key: 'emulationstation.arcade.hideoriginals',
			type: 'boolean',
			label: t('esCollections.fields.hideOriginals'),
		},
		{
			key: 'emulationstation.collection.allgames',
			type: 'boolean',
			label: t('esCollections.fields.allGames'),
		},
		{
			key: 'emulationstation.collection.multiplayers',
			type: 'boolean',
			label: t('esCollections.fields.multiplayers'),
		},
		{
			key: 'emulationstation.collection.lastplayed',
			type: 'boolean',
			label: t('esCollections.fields.lastPlayed'),
		},
	]

	const chrome = {
		save: t('save'),
		saved: t('saved'),
		saveFailed: t('saveFailed'),
		needsRestart: t('saveNeedsRestart'),
		restart: t('restartEs'),
		restartTriggered: t('restartTriggered'),
		restartFailed: t('restartFailed'),
		pending: t('unsaved'),
		none: t('noChanges'),
	}

	return (
		<div className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
			<div className="space-y-3">
				<Link href="/configuration" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
					<ArrowLeft className="size-4" />
					{t('back')}
				</Link>
				<div>
					<h1 className="text-2xl font-bold">{t('esCollections.title')}</h1>
					<p className="text-muted-foreground text-sm">{t('esCollections.subtitle')}</p>
				</div>
			</div>

			<SshConfForm
				endpoint="/api/recalbox/es-collections"
				fields={fields}
				initial={initial}
				chrome={chrome}
			/>
		</div>
	)
}
