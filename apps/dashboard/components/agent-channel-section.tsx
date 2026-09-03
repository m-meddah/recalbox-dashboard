'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type Channel = 'stable' | 'beta'

/**
 * Choix du canal, à côté des jetons de la box — la page où l'on gère déjà tout
 * ce qui la relie au cloud. Volontairement séparé de `RecalboxForm`, partagé
 * avec la page d'ajout : une box qu'on vient de créer n'a pas encore d'agent.
 */
export function AgentChannelSection({ recalboxId }: { recalboxId: string }) {
	const t = useTranslations('recalboxes.channel')
	const [channel, setChannel] = useState<Channel | null>(null)

	useEffect(() => {
		fetch(`/api/recalboxes/${recalboxId}`)
			.then((r) => r.json())
			.then((d: { agentChannel?: string }) =>
				setChannel(d.agentChannel === 'beta' ? 'beta' : 'stable'),
			)
			.catch(() => {})
	}, [recalboxId])

	async function change(next: Channel) {
		const previous = channel
		setChannel(next)
		const res = await fetch(`/api/recalboxes/${recalboxId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ agentChannel: next }),
		}).catch(() => null)
		if (!res?.ok) {
			setChannel(previous)
			toast.error(t('error'))
		}
	}

	if (!channel) return null

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">{t('heading')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				<select
					aria-label={t('heading')}
					className="block w-full rounded border bg-background px-2 py-1 text-sm"
					value={channel}
					onChange={(e) => void change(e.target.value as Channel)}
				>
					<option value="stable">{t('stable')}</option>
					<option value="beta">{t('beta')}</option>
				</select>
				<p className="text-xs text-muted-foreground">{t('hint')}</p>
			</CardContent>
		</Card>
	)
}
