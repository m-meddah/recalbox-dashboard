'use client'

import { InviteForm } from '@/components/admin/invite-form'
import { PendingInvitations } from '@/components/admin/pending-invitations'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

export function InvitationsSection() {
	const t = useTranslations('invitations')
	const [reloadKey, setReloadKey] = useState(0)

	return (
		<section className="space-y-4 border rounded-lg p-4">
			<h2 className="font-medium">{t('heading')}</h2>
			<InviteForm onCreated={() => setReloadKey((k) => k + 1)} />
			<div className="space-y-2">
				<h3 className="text-xs font-normal text-muted-foreground">{t('pendingHeading')}</h3>
				<PendingInvitations reloadKey={reloadKey} />
			</div>
		</section>
	)
}
