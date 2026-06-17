import { type SshConfFieldDef, SshConfForm } from '@/components/config/ssh-conf-form'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { loadConfSectionValues } from '@/lib/recalbox/conf-section-load'
import { RATIO_OPTIONS, SHADERSET_OPTIONS, VIDEO_SPECS } from '@/lib/recalbox/conf-sections'
import { ArrowLeft } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ locale: string }> }

export default async function VideoPage({ params }: Props) {
	const { locale } = await params
	setRequestLocale(locale as (typeof routing.locales)[number])
	const t = await getTranslations('config')
	const initial = await loadConfSectionValues(VIDEO_SPECS)

	const shadersetOptions = SHADERSET_OPTIONS.map((v) => ({
		value: v,
		label: t(`video.shadersetOptions.${v}`),
	}))
	const ratioOptions = RATIO_OPTIONS.map((v) => ({
		value: v,
		label: v === 'auto' ? t('video.ratioAuto') : v === 'custom' ? t('video.ratioCustom') : v,
	}))

	const fields: SshConfFieldDef[] = [
		{
			key: 'global.shaderset',
			type: 'enum',
			label: t('video.fields.shaderset'),
			options: shadersetOptions,
		},
		{ key: 'global.ratio', type: 'enum', label: t('video.fields.ratio'), options: ratioOptions },
		{ key: 'global.smooth', type: 'boolean', label: t('video.fields.smooth') },
		{ key: 'global.integerscale', type: 'boolean', label: t('video.fields.integerscale') },
		{
			key: 'global.rewind',
			type: 'boolean',
			label: t('video.fields.rewind'),
			description: t('video.fields.rewindDesc'),
		},
		{
			key: 'global.autosave',
			type: 'boolean',
			label: t('video.fields.autosave'),
			description: t('video.fields.autosaveDesc'),
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
					<h1 className="text-2xl font-bold">{t('video.title')}</h1>
					<p className="text-muted-foreground text-sm">{t('video.subtitle')}</p>
				</div>
			</div>

			<SshConfForm
				endpoint="/api/recalbox/video-defaults"
				fields={fields}
				initial={initial}
				chrome={chrome}
			/>
		</div>
	)
}
