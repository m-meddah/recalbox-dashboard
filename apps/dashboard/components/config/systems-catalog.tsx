'use client'

import { useCanControl } from '@/components/can-control-provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { EmulatorRating, SystemCatalogEntry } from '@/lib/recalbox/web-config'
import { AlertTriangle, Loader2, Search, Star, Wifi } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

type RatingKey = 'high' | 'good' | 'average' | 'low'
type Override = { emulator: string | null; core: string | null }

const RATING_LABEL: Record<EmulatorRating, RatingKey | null> = {
	0: null,
	1: 'high',
	2: 'good',
	3: 'average',
	4: 'low',
}
const AUTO = '__auto__'
const combo = (e: string, c: string) => `${e}|${c}`

export function SystemsCatalog() {
	const t = useTranslations('config')
	const [systems, setSystems] = useState<SystemCatalogEntry[] | null>(null)
	const [overrides, setOverrides] = useState<Record<string, Override>>({})
	const [error, setError] = useState(false)
	const [query, setQuery] = useState('')

	useEffect(() => {
		let active = true
		;(async () => {
			try {
				const [catRes, ovrRes] = await Promise.all([
					fetch('/api/recalbox/systems', { cache: 'no-store' }),
					fetch('/api/recalbox/system-emulator', { cache: 'no-store' }),
				])
				if (!catRes.ok) throw new Error(String(catRes.status))
				const cat = (await catRes.json()) as { systems: SystemCatalogEntry[] }
				const ovr = ovrRes.ok
					? ((await ovrRes.json()) as { overrides: Record<string, Override> }).overrides
					: {}
				if (active) {
					setSystems(cat.systems)
					setOverrides(ovr)
				}
			} catch {
				if (active) {
					setError(true)
					setSystems([])
				}
			}
		})()
		return () => {
			active = false
		}
	}, [])

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!q || !systems) return systems ?? []
		return systems.filter(
			(s) =>
				s.fullName.toLowerCase().includes(q) ||
				s.name.toLowerCase().includes(q) ||
				s.manufacturer.toLowerCase().includes(q),
		)
	}, [systems, query])

	if (systems === null) {
		return (
			<div className="grid gap-4 sm:grid-cols-2">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-44 w-full" />
				))}
			</div>
		)
	}

	return (
		<div className="space-y-4">
			{error && (
				<Alert variant="destructive">
					<AlertTriangle className="size-4" />
					<AlertDescription>{t('loadFailed')}</AlertDescription>
				</Alert>
			)}

			<div className="relative max-w-sm">
				<Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={t('systems.searchPlaceholder')}
					className="pl-8"
				/>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				{filtered.map((sys) => (
					<SystemCard key={sys.name} sys={sys} override={overrides[sys.name]} />
				))}
			</div>
		</div>
	)
}

function SystemCard({ sys, override }: { sys: SystemCatalogEntry; override?: Override }) {
	const t = useTranslations('config')
	const canControl = useCanControl()
	const initial =
		override?.emulator && override?.core ? combo(override.emulator, override.core) : AUTO
	const [value, setValue] = useState(initial)
	const [saved, setSaved] = useState(initial)
	const [saving, setSaving] = useState(false)

	async function save() {
		setSaving(true)
		const [em, co] = value === AUTO ? [null, null] : value.split('|')
		try {
			const res = await fetch('/api/recalbox/system-emulator', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ system: sys.name, emulator: em ?? null, core: co ?? null }),
			})
			if (!res.ok) throw new Error(String(res.status))
			setSaved(value)
			toast.success(t('systems.saved', { system: sys.fullName }))
		} catch {
			toast.error(t('systems.saveError'))
		} finally {
			setSaving(false)
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-baseline justify-between gap-2 text-base">
					<span>{sys.fullName}</span>
					{sys.manufacturer && (
						<span className="text-muted-foreground text-xs font-normal">{sys.manufacturer}</span>
					)}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{canControl && (
					<div className="space-y-1.5">
						<span className="text-muted-foreground text-xs font-medium">
							{t('systems.defaultEmulator')}
						</span>
						<div className="flex gap-2">
							<Select value={value} onValueChange={(v) => setValue(v ?? AUTO)}>
								<SelectTrigger className="h-8">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={AUTO}>{t('systems.auto')}</SelectItem>
									{sys.emulators.map((e) => (
										<SelectItem key={combo(e.emulator, e.core)} value={combo(e.emulator, e.core)}>
											{e.emulator} · {e.core}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button size="sm" onClick={save} disabled={saving || value === saved}>
								{saving ? <Loader2 className="size-4 animate-spin" /> : t('systems.save')}
							</Button>
						</div>
					</div>
				)}

				<div className="space-y-1.5">
					{sys.emulators.map((e, i) => {
						const speedKey = RATING_LABEL[e.speed]
						const compatKey = RATING_LABEL[e.compatibility]
						return (
							<div
								key={`${e.emulator}-${e.core}`}
								className="flex flex-wrap items-center gap-2 text-sm"
							>
								{i === 0 && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
								<span className="font-medium">{e.emulator}</span>
								<span className="text-muted-foreground">·</span>
								<span>{e.core}</span>
								{speedKey && (
									<Badge variant="secondary" className="text-[10px]">
										{t('systems.speed')}: {t(`systems.rating.${speedKey}`)}
									</Badge>
								)}
								{compatKey && (
									<Badge variant="secondary" className="text-[10px]">
										{t('systems.compat')}: {t(`systems.rating.${compatKey}`)}
									</Badge>
								)}
								{e.hasNetplay && (
									<Badge variant="outline" className="gap-1 text-[10px]">
										<Wifi className="size-3" />
										{t('systems.netplay')}
									</Badge>
								)}
							</div>
						)
					})}
				</div>
			</CardContent>
		</Card>
	)
}
