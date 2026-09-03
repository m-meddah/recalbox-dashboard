'use client'

import { AgentChannelSection } from '@/components/agent-channel-section'
import { AgentCommandsSection } from '@/components/agent-commands-section'
import { AgentTokensSection } from '@/components/agent-tokens-section'
import { RecalboxForm, type RecalboxFormValues } from '@/components/recalbox-form'
import { useServerless } from '@/components/serverless-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { use, useEffect, useState } from 'react'
import { toast } from 'sonner'

export default function EditRecalboxPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = use(params)
	const t = useTranslations('recalboxes')
	const router = useRouter()
	const serverless = useServerless()
	const [loading, setLoading] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const [rb, setRb] = useState<(RecalboxFormValues & { name: string }) | null>(null)

	useEffect(() => {
		fetch(`/api/recalboxes/${id}`)
			.then((r) => r.json())
			.then((data) => setRb({ ...data, sshPassword: '' }))
			.catch(() => {})
	}, [id])

	async function handleSubmit(values: RecalboxFormValues) {
		setLoading(true)
		try {
			const res = await fetch(`/api/recalboxes/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			})
			if (!res.ok) {
				const reason = await res
					.json()
					.then((d: { error?: unknown }) => (typeof d.error === 'string' ? d.error : null))
					.catch(() => null)
				throw new Error(reason ?? '')
			}
			toast.success(t('edit.success'))
			router.push('/recalboxes')
		} catch (err) {
			const reason = err instanceof Error ? err.message : ''
			toast.error(reason ? `${t('edit.error')} — ${reason}` : t('edit.error'))
		} finally {
			setLoading(false)
		}
	}

	async function handleDelete() {
		if (!confirm(t('edit.deleteConfirm'))) return
		setDeleting(true)
		try {
			const res = await fetch(`/api/recalboxes/${id}`, { method: 'DELETE' })
			if (!res.ok) {
				const d = await res.json()
				toast.error(d.error ?? t('edit.deleteError'))
				return
			}
			toast.success(t('edit.deleteSuccess'))
			router.push('/recalboxes')
		} catch {
			toast.error(t('edit.deleteError'))
		} finally {
			setDeleting(false)
		}
	}

	async function handleArchive() {
		await fetch(`/api/recalboxes/${id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ archived: true }),
		})
		toast.success(t('edit.archived'))
		router.push('/recalboxes')
	}

	if (!rb) return <div className="p-8 text-muted-foreground text-sm">{t('edit.loading')}</div>

	return (
		<div className="container max-w-lg mx-auto p-6 space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>{t('edit.title', { name: rb.name })}</CardTitle>
				</CardHeader>
				<CardContent>
					<RecalboxForm
						defaultValues={rb}
						onSubmit={handleSubmit}
						loading={loading}
						testUrl={`/api/recalboxes/${id}/test-connection`}
						submitLabel={t('edit.submit')}
						serverless={serverless}
					/>
				</CardContent>
			</Card>
			<div className="flex gap-2">
				<Button variant="outline" onClick={handleArchive}>
					{t('edit.archive')}
				</Button>
				<Button variant="destructive" onClick={handleDelete} disabled={deleting}>
					{t('edit.delete')}
				</Button>
			</div>
			<AgentChannelSection recalboxId={id} />
			<AgentTokensSection recalboxId={id} />
			<AgentCommandsSection recalboxId={id} />
		</div>
	)
}
