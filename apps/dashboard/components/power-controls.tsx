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
import { Power, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

type Action = 'shutdown' | 'reboot'

function PowerAction({ action }: { action: Action }) {
	const t = useTranslations('power')
	const tCommon = useTranslations('common')
	const isShutdown = action === 'shutdown'

	async function handleConfirm() {
		try {
			const res = await fetch('/api/system/power', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action }),
			})
			if (!res.ok) throw new Error('unreachable')
			toast(isShutdown ? t('shutdownToast') : t('rebootToast'))
		} catch {
			toast.error(tCommon('error'))
		}
	}

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button variant="ghost" size="icon" aria-label={t(action)}>
					{isShutdown ? <Power className="size-4" /> : <RotateCcw className="size-4" />}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{isShutdown ? t('confirmShutdownTitle') : t('confirmRebootTitle')}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{isShutdown ? t('confirmShutdownDescription') : t('confirmRebootDescription')}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
					<AlertDialogAction onClick={handleConfirm}>
						{t(action)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

export function PowerControls() {
	return (
		<>
			<PowerAction action="reboot" />
			<PowerAction action="shutdown" />
		</>
	)
}
