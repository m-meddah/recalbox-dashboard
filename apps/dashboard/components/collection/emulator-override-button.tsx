'use client'

import { useCanControl } from '@/components/can-control-provider'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { useGameRunning } from '@/hooks/use-game-running'
import type { EmulatorChoice, SystemCatalogEntry } from '@/lib/recalbox/web-config'
import { Cpu, Loader2, Star } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

type Props = {
	romPath: string
	system: string
	name: string
	emulator: string | null
	core: string | null
}

const DEFAULT_VALUE = '__default__'
const sep = (e: string, c: string) => `${e}|${c}`

// One catalog fetch per system, shared across every row.
const catalogCache = new Map<string, Promise<EmulatorChoice[]>>()

function loadCatalog(system: string): Promise<EmulatorChoice[]> {
	let p = catalogCache.get(system)
	if (!p) {
		p = fetch('/api/recalbox/systems', { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : { systems: [] }))
			.then(
				(d: { systems: SystemCatalogEntry[] }) =>
					d.systems.find((s) => s.name === system)?.emulators ?? [],
			)
			.catch(() => [])
		catalogCache.set(system, p)
	}
	return p
}

export function EmulatorOverrideButton({ romPath, system, name, emulator, core }: Props) {
	const t = useTranslations('collection.emulator')
	const tCommon = useTranslations('common')
	const { running, gameName } = useGameRunning()
	const canControl = useCanControl()
	const [open, setOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [choices, setChoices] = useState<EmulatorChoice[] | null>(null)
	const [value, setValue] = useState(emulator && core ? sep(emulator, core) : DEFAULT_VALUE)

	if (!canControl) return null

	async function onOpenChange(next: boolean) {
		setOpen(next)
		if (next && choices === null) setChoices(await loadCatalog(system))
	}

	async function handleSave() {
		setSaving(true)
		const [em, co] = value === DEFAULT_VALUE ? [null, null] : value.split('|')
		try {
			const res = await fetch('/api/collection/emulator-override', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ romPath, system, emulator: em ?? null, core: co ?? null }),
			})
			if (res.status === 409) {
				const data = (await res.json().catch(() => null)) as { gameName?: string } | null
				toast.error(t('busy', { name: data?.gameName ?? '' }))
				return
			}
			if (!res.ok) throw new Error('save failed')
			setOpen(false)
			// Apply: ES must reload gamelist.xml from disk.
			await fetch('/api/system/frontend', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'restart' }),
			}).catch(() => {})
			toast.success(t('saved', { name }))
		} catch {
			toast.error(t('error'))
		} finally {
			setSaving(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						aria-label={t('action')}
						title={running ? t('busy', { name: gameName ?? '' }) : t('action')}
						disabled={running}
					/>
				}
			>
				<Cpu className={emulator ? 'size-4 text-primary' : 'size-4'} />
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('title')}</DialogTitle>
					<DialogDescription>{t('description', { name })}</DialogDescription>
				</DialogHeader>

				<div className="space-y-2 py-2">
					<Select value={value} onValueChange={(v) => setValue(v ?? DEFAULT_VALUE)}>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={DEFAULT_VALUE}>{t('systemDefault')}</SelectItem>
							{(choices ?? []).map((c, i) => (
								<SelectItem key={sep(c.emulator, c.core)} value={sep(c.emulator, c.core)}>
									<span className="flex items-center gap-1.5">
										{i === 0 && <Star className="size-3 fill-amber-400 text-amber-400" />}
										{c.emulator} · {c.core}
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs">{t('restartNote')}</p>
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
						{tCommon('cancel')}
					</Button>
					<Button onClick={handleSave} disabled={saving}>
						{saving && <Loader2 className="size-4 animate-spin" />}
						{t('apply')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
