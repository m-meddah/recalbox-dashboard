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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Power, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

type PowerAction = 'reboot' | 'shutdown'
type CommandStatus = 'pending' | 'claimed' | 'done' | 'failed'
type AgentCommand = {
	id: string
	type: string
	payload: Record<string, unknown> | null
	status: CommandStatus
	createdAt: string
	result: string | null
}

function isPending(c: AgentCommand) {
	return c.status === 'pending' || c.status === 'claimed'
}

/** One-line human summary of a queued command (type + its key param). */
function describe(c: AgentCommand): string {
	const p = c.payload ?? {}
	if (c.type === 'power') return `power · ${String(p.action ?? '')}`
	if (c.type === 'conf') return `conf · ${String(p.key ?? '')}=${String(p.value ?? '')}`
	if (c.type === 'launch') return `launch · ${String(p.system ?? '')}`
	return c.type
}

function StatusBadge({ status, label }: { status: CommandStatus; label: string }) {
	const tone =
		status === 'done'
			? 'text-emerald-600 dark:text-emerald-500'
			: status === 'failed'
				? 'text-red-600 dark:text-red-500'
				: 'text-muted-foreground'
	return <span className={`shrink-0 text-xs ${tone}`}>{label}</span>
}

function PowerCommandButton({
	action,
	busy,
	onConfirm,
}: {
	action: PowerAction
	busy: boolean
	onConfirm: (body: Record<string, unknown>) => Promise<boolean>
}) {
	const tPower = useTranslations('power')
	const tCommon = useTranslations('common')
	const isShutdown = action === 'shutdown'
	const [open, setOpen] = useState(false)
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger render={<Button variant="outline" size="sm" disabled={busy} />}>
				{isShutdown ? <Power className="size-4" /> : <RotateCcw className="size-4" />}
				{tPower(action)}
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{isShutdown ? tPower('confirmShutdownTitle') : tPower('confirmRebootTitle')}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{isShutdown ? tPower('confirmShutdownDescription') : tPower('confirmRebootDescription')}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
					<AlertDialogAction
						onClick={async () => {
							setOpen(false)
							await onConfirm({ type: 'power', action })
						}}
					>
						{tPower(action)}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

export function AgentCommandsSection({ recalboxId }: { recalboxId: string }) {
	const t = useTranslations('remoteControl')
	const [commands, setCommands] = useState<AgentCommand[]>([])
	const [confKey, setConfKey] = useState('')
	const [confValue, setConfValue] = useState('')
	const [busy, setBusy] = useState(false)

	const load = useCallback(() => {
		fetch(`/api/recalboxes/${recalboxId}/commands`)
			.then((r) => (r.ok ? r.json() : { commands: [] }))
			.then((d: { commands: AgentCommand[] }) => setCommands(d.commands ?? []))
			.catch(() => setCommands([]))
	}, [recalboxId])

	useEffect(() => {
		load()
	}, [load])

	// Poll while a command is still in flight so the agent's progress shows up.
	useEffect(() => {
		if (!commands.some(isPending)) return
		const tmr = setTimeout(load, 5000)
		return () => clearTimeout(tmr)
	}, [commands, load])

	const enqueue = useCallback(
		async (body: Record<string, unknown>) => {
			setBusy(true)
			try {
				const res = await fetch(`/api/recalboxes/${recalboxId}/commands`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				})
				if (!res.ok) throw new Error()
				toast.success(t('sent'))
				load()
				return true
			} catch {
				toast.error(t('sendError'))
				return false
			} finally {
				setBusy(false)
			}
		},
		[recalboxId, t, load],
	)

	async function submitConf(e: React.FormEvent) {
		e.preventDefault()
		const key = confKey.trim()
		if (!key) return
		const ok = await enqueue({ type: 'conf', key, value: confValue })
		if (ok) {
			setConfKey('')
			setConfValue('')
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('heading')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground text-sm">{t('description')}</p>

				<div className="flex flex-wrap gap-2">
					<PowerCommandButton action="reboot" busy={busy} onConfirm={enqueue} />
					<PowerCommandButton action="shutdown" busy={busy} onConfirm={enqueue} />
				</div>

				<form onSubmit={submitConf} className="space-y-2 rounded border p-3">
					<p className="font-medium text-sm">{t('confHeading')}</p>
					<div className="flex flex-col gap-2 sm:flex-row">
						<input
							type="text"
							placeholder={t('confKeyPlaceholder')}
							value={confKey}
							onChange={(e) => setConfKey(e.target.value)}
							className="flex-1 rounded border px-3 py-2 text-sm"
						/>
						<input
							type="text"
							placeholder={t('confValuePlaceholder')}
							value={confValue}
							onChange={(e) => setConfValue(e.target.value)}
							className="flex-1 rounded border px-3 py-2 text-sm"
						/>
						<Button type="submit" variant="outline" disabled={busy || !confKey.trim()}>
							{t('confSubmit')}
						</Button>
					</div>
				</form>

				<div className="space-y-2">
					<p className="font-medium text-sm">{t('history')}</p>
					{commands.length === 0 ? (
						<p className="text-muted-foreground text-sm">{t('noHistory')}</p>
					) : (
						<ul className="space-y-1">
							{commands.map((c) => (
								<li
									key={c.id}
									className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
								>
									<span className="min-w-0 truncate">
										<span className="font-mono text-xs">{describe(c)}</span>{' '}
										<span className="text-muted-foreground text-xs">
											{new Date(c.createdAt).toLocaleString()}
										</span>
									</span>
									<StatusBadge status={c.status} label={t(`status.${c.status}`)} />
								</li>
							))}
						</ul>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
