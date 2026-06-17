'use client'

import { useCanControl } from '@/components/can-control-provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import type { OverclockInfo } from '@/lib/recalbox/overclock'
import { AlertTriangle, Loader2, RotateCw, Thermometer } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

const STOCK = '__stock__'

export function OverclockPanel({ info }: { info: OverclockInfo }) {
	const t = useTranslations('config')
	const canControl = useCanControl()
	const [selected, setSelected] = useState(info.current ?? STOCK)
	const [applied, setApplied] = useState(info.current ?? STOCK)
	const [saving, setSaving] = useState(false)
	const [confirmOpen, setConfirmOpen] = useState(false)
	const [rebootOpen, setRebootOpen] = useState(false)

	if (!info.supported) {
		return (
			<Alert>
				<AlertTriangle className="size-4" />
				<AlertDescription>
					{t('performance.unsupported', { model: info.modelName ?? '?' })}
				</AlertDescription>
			</Alert>
		)
	}

	async function apply() {
		setSaving(true)
		try {
			const res = await fetch('/api/recalbox/overclock', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ profile: selected === STOCK ? null : selected }),
			})
			if (!res.ok) throw new Error(String(res.status))
			setApplied(selected)
			toast.success(t('performance.applied'), {
				description: t('performance.rebootNeeded'),
				action: { label: t('performance.reboot'), onClick: () => setRebootOpen(true) },
			})
		} catch {
			toast.error(t('performance.applyFailed'))
		} finally {
			setSaving(false)
		}
	}

	async function reboot() {
		try {
			const res = await fetch('/api/system/power', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'reboot' }),
			})
			if (!res.ok) throw new Error(String(res.status))
			toast.success(t('performance.rebootTriggered'))
		} catch {
			toast.error(t('performance.rebootFailed'))
		}
	}

	const throttleWarn = info.throttle?.throttledNow || info.throttle?.throttledOccurred

	// Known profiles get a localized label; any other profile name shows verbatim.
	const profileLabel = (p: string) => {
		if (p === 'medium') return t('performance.profiles.medium')
		if (p === 'high') return t('performance.profiles.high')
		return p
	}

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center justify-between gap-2 text-base">
						<span>{info.modelName ?? t('performance.title')}</span>
						<div className="flex items-center gap-2">
							{info.temp !== null && (
								<Badge variant="secondary" className="gap-1">
									<Thermometer className="size-3" />
									{info.temp.toFixed(1)}°C
								</Badge>
							)}
							{info.throttle && (
								<Badge variant={throttleWarn ? 'destructive' : 'outline'}>
									{throttleWarn ? t('performance.throttleWarn') : t('performance.throttleOk')}
								</Badge>
							)}
						</div>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<Alert>
						<AlertTriangle className="size-4" />
						<AlertDescription>{t('performance.warning')}</AlertDescription>
					</Alert>

					{canControl ? (
						<>
							<div className="space-y-1.5">
								<span className="text-muted-foreground text-xs font-medium">
									{t('performance.profile')}
								</span>
								<Select value={selected} onValueChange={(v) => setSelected(v ?? STOCK)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={STOCK}>{t('performance.profiles.stock')}</SelectItem>
										{info.available.map((p) => (
											<SelectItem key={p} value={p}>
												{profileLabel(p)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="flex items-center justify-end gap-3">
								<Button type="button" variant="ghost" size="sm" onClick={() => setRebootOpen(true)}>
									<RotateCw className="size-4" />
									{t('performance.reboot')}
								</Button>
								<Button
									type="button"
									onClick={() => setConfirmOpen(true)}
									disabled={saving || selected === applied}
								>
									{saving ? <Loader2 className="size-4 animate-spin" /> : null}
									{t('performance.apply')}
								</Button>
							</div>
						</>
					) : (
						<p className="text-muted-foreground text-sm">
							{t('performance.current', {
								profile: applied === STOCK ? t('performance.profiles.stock') : applied,
							})}
						</p>
					)}
				</CardContent>
			</Card>

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('performance.confirmTitle')}</AlertDialogTitle>
						<AlertDialogDescription>{t('performance.confirmBody')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setConfirmOpen(false)
								void apply()
							}}
						>
							{t('applyAnyway')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={rebootOpen} onOpenChange={setRebootOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('performance.rebootConfirmTitle')}</AlertDialogTitle>
						<AlertDialogDescription>{t('performance.rebootConfirmBody')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setRebootOpen(false)
								void reboot()
							}}
						>
							{t('performance.reboot')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
