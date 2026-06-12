'use client'

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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { humanizeKey, isSecretKey } from '@/lib/recalbox/config-schema'
import type { ConfigField, ConfigValue } from '@/lib/recalbox/web-config'
import { SECRET_SENTINEL } from '@/lib/recalbox/web-config'
import { AlertTriangle, Loader2, RotateCw, Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

type Props = {
	section: string
	risky?: boolean
	requiresEsRestart?: boolean
}

export function ConfigSectionForm({ section, risky = false, requiresEsRestart = false }: Props) {
	const t = useTranslations('config')
	const [fields, setFields] = useState<ConfigField[] | null>(null)
	const [draft, setDraft] = useState<Record<string, ConfigValue>>({})
	const [loadError, setLoadError] = useState(false)
	const [saving, setSaving] = useState(false)
	const [confirmOpen, setConfirmOpen] = useState(false)

	const load = useCallback(async () => {
		setLoadError(false)
		try {
			const res = await fetch(`/api/recalbox/config/${section}`, { cache: 'no-store' })
			if (!res.ok) throw new Error(String(res.status))
			const data = (await res.json()) as { fields: ConfigField[] }
			setFields(data.fields)
			setDraft(Object.fromEntries(data.fields.map((f) => [f.key, f.value])))
		} catch {
			setLoadError(true)
			setFields([])
		}
	}, [section])

	useEffect(() => {
		void load()
	}, [load])

	const original = useMemo(
		() => Object.fromEntries((fields ?? []).map((f) => [f.key, f.value])),
		[fields],
	)

	const changes = useMemo(() => {
		const out: Record<string, ConfigValue> = {}
		for (const [key, value] of Object.entries(draft)) {
			if (value === original[key]) continue
			// An untouched secret stays at the sentinel — never write it back.
			if (isSecretKey(key) && value === SECRET_SENTINEL) continue
			out[key] = value
		}
		return out
	}, [draft, original])

	const dirtyCount = Object.keys(changes).length

	async function doSave() {
		setSaving(true)
		try {
			const res = await fetch(`/api/recalbox/config/${section}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ changes }),
			})
			if (!res.ok) throw new Error(String(res.status))
			toast.success(t('saved'), {
				...(requiresEsRestart && {
					description: t('saveNeedsRestart'),
					action: { label: t('restartEs'), onClick: () => void restartEs() },
				}),
			})
			await load()
		} catch {
			toast.error(t('saveFailed'))
		} finally {
			setSaving(false)
		}
	}

	function onSaveClick() {
		if (dirtyCount === 0) return
		if (risky) setConfirmOpen(true)
		else void doSave()
	}

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

	if (fields === null) {
		return (
			<div className="space-y-3">
				{[0, 1, 2, 3, 4].map((i) => (
					<Skeleton key={i} className="h-12 w-full" />
				))}
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{loadError && (
				<Alert variant="destructive">
					<AlertTriangle className="size-4" />
					<AlertDescription>{t('loadFailed')}</AlertDescription>
				</Alert>
			)}

			{risky && (
				<Alert>
					<AlertTriangle className="size-4" />
					<AlertDescription>{t('riskyWarning')}</AlertDescription>
				</Alert>
			)}

			{fields.length === 0 && !loadError ? (
				<p className="text-muted-foreground text-sm">{t('empty')}</p>
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					{fields.map((field) => (
						<FieldRow
							key={field.key}
							field={field}
							value={draft[field.key]}
							onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
						/>
					))}
				</div>
			)}

			<div className="bg-background/80 sticky bottom-0 flex items-center justify-end gap-3 border-t py-3 backdrop-blur">
				{requiresEsRestart && (
					<Button type="button" variant="ghost" size="sm" onClick={() => void restartEs()}>
						<RotateCw className="size-4" />
						{t('restartEs')}
					</Button>
				)}
				<span className="text-muted-foreground text-sm">
					{dirtyCount > 0 ? t('pendingChanges', { count: dirtyCount }) : t('noChanges')}
				</span>
				<Button type="button" onClick={onSaveClick} disabled={dirtyCount === 0 || saving}>
					{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
					{t('save')}
				</Button>
			</div>

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
						<AlertDialogDescription>{t('confirmRisky')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setConfirmOpen(false)
								void doSave()
							}}
						>
							{t('applyAnyway')}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}

function FieldRow({
	field,
	value,
	onChange,
}: {
	field: ConfigField
	value: ConfigValue | undefined
	onChange: (v: ConfigValue) => void
}) {
	const label = humanizeKey(field.key)
	const id = `cfg-${field.key}`

	if (typeof field.value === 'boolean') {
		return (
			<div className="flex items-center justify-between gap-4 rounded-lg border p-3">
				<Label htmlFor={id} className="font-normal">
					{label}
				</Label>
				<Switch id={id} checked={Boolean(value)} onCheckedChange={(c) => onChange(c)} />
			</div>
		)
	}

	const isNumber = typeof field.value === 'number'
	const secret = field.secret || isSecretKey(field.key)

	return (
		<div className="flex flex-col gap-1.5 rounded-lg border p-3">
			<Label htmlFor={id} className="font-normal">
				{label}
			</Label>
			<Input
				id={id}
				type={secret ? 'password' : isNumber ? 'number' : 'text'}
				value={value === undefined ? '' : String(value)}
				placeholder={secret ? SECRET_SENTINEL : undefined}
				autoComplete={secret ? 'new-password' : undefined}
				onChange={(e) => onChange(isNumber ? Number(e.target.value) : e.target.value)}
			/>
		</div>
	)
}
