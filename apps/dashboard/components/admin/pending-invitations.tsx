'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

type Pending = { id: string; email: string; role: string; expiresAt: number; createdAt: number }

export function PendingInvitations({ reloadKey }: { reloadKey: number }) {
	const t = useTranslations('invitations')
	const [items, setItems] = useState<Pending[]>([])

	const load = useCallback(() => {
		fetch('/api/invitations')
			.then((r) => (r.ok ? r.json() : { invitations: [] }))
			.then((data: { invitations: Pending[] }) => setItems(data.invitations ?? []))
			.catch(() => setItems([]))
	}, [])

	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey is an intentional reload trigger from the parent
	useEffect(() => {
		load()
	}, [load, reloadKey])

	async function revoke(id: string) {
		await fetch(`/api/invitations/${id}`, { method: 'DELETE' })
		load()
	}

	if (items.length === 0) {
		return <p className="text-sm text-muted-foreground">{t('none')}</p>
	}

	return (
		<ul className="space-y-2">
			{items.map((inv) => (
				<li
					key={inv.id}
					className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
				>
					<span className="truncate">
						{inv.email}{' '}
						<span className="text-xs text-muted-foreground">
							({inv.role}, {t('expires', { date: new Date(inv.expiresAt).toLocaleDateString() })})
						</span>
					</span>
					<button
						type="button"
						onClick={() => revoke(inv.id)}
						className="rounded border px-2 py-1 text-xs"
					>
						{t('revoke')}
					</button>
				</li>
			))}
		</ul>
	)
}
