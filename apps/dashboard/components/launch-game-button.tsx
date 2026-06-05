'use client'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useGameRunning } from '@/hooks/use-game-running'
import { Play } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

type Props = { romPath: string; system: string; name: string }

export function LaunchGameButton({ romPath, system, name }: Props) {
	const t = useTranslations('collection.launch')
	const tCommon = useTranslations('common')
	const { running, gameName } = useGameRunning()
	const [open, setOpen] = useState(false)
	const [busy, setBusy] = useState(false)

	async function handleConfirm() {
		setOpen(false)
		setBusy(true)
		try {
			const res = await fetch('/api/collection/launch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ romPath, system }),
			})
			if (!res.ok) throw new Error('launch failed')
			toast.success(t('launched', { name }))
		} catch {
			toast.error(t('error'))
		} finally {
			setBusy(false)
		}
	}

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						className="text-primary hover:text-primary"
						aria-label={t('action')}
						title={running ? t('busy', { name: gameName ?? '' }) : t('action')}
						disabled={busy || running}
					/>
				}
			>
				<Play className="size-4 fill-current" />
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
					<AlertDialogDescription>{t('confirmDescription', { name })}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
					<AlertDialogAction onClick={handleConfirm}>{t('action')}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
