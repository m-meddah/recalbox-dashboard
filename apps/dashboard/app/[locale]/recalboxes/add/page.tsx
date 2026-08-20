'use client'

import { RecalboxForm, type RecalboxFormValues } from '@/components/recalbox-form'
import { SetupWizard } from '@/components/recalboxes/setup-wizard'
import { useServerless } from '@/components/serverless-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

/** Only a screen the wizard actually knows how to enter directly — anything else
 * (a stray/garbled query string) falls back to the component's own default
 * rather than handing it a value it doesn't recognise. */
function parseWizardScreen(value: string | null): 'name' | 'install' | 'wait' | undefined {
	return value === 'name' || value === 'install' || value === 'wait' ? value : undefined
}

export default function AddRecalboxPage() {
	const t = useTranslations('recalboxes')
	const router = useRouter()
	const serverless = useServerless()
	const searchParams = useSearchParams()
	const [loading, setLoading] = useState(false)

	// Serverless enrollment has no SSH/MQTT to reach for — it's zip download +
	// waiting for the box to phone home — so it gets its own guided flow.
	// Self-hosted keeps the plain connection form below, unchanged.
	//
	// `startAt`/`recalboxId` let the recalboxes list bring a box that was never
	// installed straight back to the screen it left off on (the "resume" link),
	// instead of restarting enrollment from a blank name field.
	if (serverless) {
		return (
			<div className="container max-w-lg mx-auto p-6">
				<SetupWizard
					startAt={parseWizardScreen(searchParams.get('startAt'))}
					recalboxId={searchParams.get('recalboxId') ?? undefined}
				/>
			</div>
		)
	}

	async function handleSubmit(values: RecalboxFormValues) {
		setLoading(true)
		try {
			const res = await fetch('/api/recalboxes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			})
			if (!res.ok) {
				// Show what the API actually rejected. Swallowing it left the only failure a
				// first-time user is likely to hit — a payload the schema refuses — looking
				// like a generic outage, with nothing pointing at the field to fix.
				const reason = await res
					.json()
					.then((d: { error?: unknown }) => (typeof d.error === 'string' ? d.error : null))
					.catch(() => null)
				throw new Error(reason ?? '')
			}
			toast.success(t('add.success'))
			router.push('/recalboxes')
		} catch (err) {
			const reason = err instanceof Error ? err.message : ''
			toast.error(reason ? `${t('add.error')} — ${reason}` : t('add.error'))
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="container max-w-lg mx-auto p-6">
			<Card>
				<CardHeader>
					<CardTitle>{t('add.title')}</CardTitle>
				</CardHeader>
				<CardContent>
					<RecalboxForm
						onSubmit={handleSubmit}
						loading={loading}
						submitLabel={t('add.submit')}
						serverless={serverless}
					/>
				</CardContent>
			</Card>
		</div>
	)
}
