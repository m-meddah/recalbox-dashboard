'use client'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { AlertTriangle, Loader2, Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

type RegionPrefs = {
	region: string | null
	fallback: string | null
	oneGameOneRom: boolean
	showOnlyLatest: boolean
}

const AUTO = '__auto__'
// Common ScreenScraper / EmulationStation region codes.
const REGIONS = ['eu', 'us', 'jp', 'fr', 'de', 'es', 'it', 'uk', 'world'] as const

export function RegionPreferencesForm() {
	const t = useTranslations('config')
	const [loaded, setLoaded] = useState<{ prefs: RegionPrefs | null; error: boolean }>({
		prefs: null,
		error: false,
	})
	const [draft, setDraft] = useState<RegionPrefs | null>(null)
	const [saving, setSaving] = useState(false)

	const load = useCallback(async () => {
		try {
			const res = await fetch('/api/recalbox/region-prefs', { cache: 'no-store' })
			if (!res.ok) throw new Error(String(res.status))
			const data = (await res.json()) as { prefs: RegionPrefs }
			setLoaded({ prefs: data.prefs, error: false })
			setDraft(data.prefs)
		} catch {
			setLoaded({ prefs: null, error: true })
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	const { prefs, error: loadError } = loaded
	const dirty = useMemo(
		() => Boolean(draft && prefs) && JSON.stringify(draft) !== JSON.stringify(prefs),
		[draft, prefs],
	)

	async function restartEs() {
		try {
			const res = await fetch('/api/system/frontend', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'restart' }),
			})
			if (!res.ok) throw new Error(String(res.status))
			toast.success(t('restartTriggered'))
		} catch {
			toast.error(t('restartFailed'))
		}
	}

	async function save() {
		if (!draft) return
		setSaving(true)
		try {
			const res = await fetch('/api/recalbox/region-prefs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(draft),
			})
			if (!res.ok) throw new Error(String(res.status))
			toast.success(t('saved'), {
				description: t('saveNeedsRestart'),
				action: { label: t('restartEs'), onClick: () => void restartEs() },
			})
			await load()
		} catch {
			toast.error(t('saveFailed'))
		} finally {
			setSaving(false)
		}
	}

	if (!draft) {
		if (loadError) {
			return (
				<Alert variant="destructive">
					<AlertTriangle className="size-4" />
					<AlertDescription>{t('loadFailed')}</AlertDescription>
				</Alert>
			)
		}
		return (
			<div className="space-y-3">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-14 w-full" />
				))}
			</div>
		)
	}

	const set = (patch: Partial<RegionPrefs>) => setDraft((d) => (d ? { ...d, ...patch } : d))

	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5 rounded-lg border p-3">
					<Label htmlFor="region-pref">{t('region.region')}</Label>
					<Select
						value={draft.region ?? AUTO}
						onValueChange={(v) => set({ region: v === AUTO ? null : v })}
					>
						<SelectTrigger id="region-pref">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={AUTO}>{t('region.auto')}</SelectItem>
							{REGIONS.map((r) => (
								<SelectItem key={r} value={r}>
									{t(`region.codes.${r}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex flex-col gap-1.5 rounded-lg border p-3">
					<Label htmlFor="fallback-pref">{t('region.fallback')}</Label>
					<Input
						id="fallback-pref"
						value={draft.fallback ?? ''}
						placeholder="Europe > Japan > World > USA"
						onChange={(e) => set({ fallback: e.target.value })}
					/>
				</div>

				<div className="flex items-center justify-between gap-4 rounded-lg border p-3">
					<Label htmlFor="one-game" className="font-normal">
						{t('region.oneGameOneRom')}
					</Label>
					<Switch
						id="one-game"
						checked={draft.oneGameOneRom}
						onCheckedChange={(c) => set({ oneGameOneRom: c })}
					/>
				</div>

				<div className="flex items-center justify-between gap-4 rounded-lg border p-3">
					<Label htmlFor="latest-only" className="font-normal">
						{t('region.showOnlyLatest')}
					</Label>
					<Switch
						id="latest-only"
						checked={draft.showOnlyLatest}
						onCheckedChange={(c) => set({ showOnlyLatest: c })}
					/>
				</div>
			</div>

			<div className="bg-background/80 sticky bottom-0 flex items-center justify-end gap-3 border-t py-3 backdrop-blur">
				<span className="text-muted-foreground text-sm">
					{dirty ? t('pendingChanges', { count: 1 }) : t('noChanges')}
				</span>
				<Button type="button" onClick={() => void save()} disabled={!dirty || saving}>
					{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
					{t('save')}
				</Button>
			</div>
		</div>
	)
}
