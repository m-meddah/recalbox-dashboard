'use client'

import { RecalboxForm, type RecalboxFormValues } from '@/components/recalbox-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

export default function AddRecalboxPage() {
	const t = useTranslations('recalboxes')
	const router = useRouter()
	const [loading, setLoading] = useState(false)

	async function handleSubmit(values: RecalboxFormValues) {
		setLoading(true)
		try {
			const res = await fetch('/api/recalboxes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			})
			if (!res.ok) throw new Error()
			toast.success(t('add.success'))
			router.push('/recalboxes')
		} catch {
			toast.error(t('add.error'))
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
					<RecalboxForm onSubmit={handleSubmit} loading={loading} submitLabel={t('add.submit')} />
				</CardContent>
			</Card>
		</div>
	)
}
