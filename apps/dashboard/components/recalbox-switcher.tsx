'use client'

import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Link, useRouter } from '@/i18n/navigation'
import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type RecalboxItem = {
	id: string
	name: string
	iconEmoji: string | null
	isDefault: boolean
	archived: boolean
}

type Props = {
	recalboxes: RecalboxItem[]
	activeId: string | null
}

export function RecalboxSwitcher({ recalboxes, activeId }: Props) {
	const t = useTranslations('recalboxes')
	const router = useRouter()
	const [switching, setSwitching] = useState(false)

	const active = recalboxes.find((r) => r.id === activeId) ?? recalboxes[0]

	async function switchRecalbox(id: string) {
		setSwitching(true)
		await fetch('/api/recalboxes/active', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id }),
		})
		setSwitching(false)
		router.refresh()
	}

	if (recalboxes.length <= 1) return null

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" disabled={switching}>
					{active?.iconEmoji ?? '🕹️'} {active?.name ?? '…'} ▾
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>{t('switcher.label')}</DropdownMenuLabel>
				{recalboxes
					.filter((r) => !r.archived)
					.map((rb) => (
						<DropdownMenuItem key={rb.id} onClick={() => switchRecalbox(rb.id)}>
							<span className="mr-2">{rb.iconEmoji ?? '🕹️'}</span>
							<span className="flex-1">{rb.name}</span>
							{rb.id === activeId && <Check className="h-4 w-4 ml-2" />}
						</DropdownMenuItem>
					))}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/recalboxes">{t('switcher.manage')}</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link href="/recalboxes/add">{t('switcher.add')}</Link>
				</DropdownMenuItem>
				{recalboxes.filter((r) => !r.archived).length >= 2 && (
					<DropdownMenuItem asChild>
						<Link href="/all-recalboxes">{t('switcher.viewAll')}</Link>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
