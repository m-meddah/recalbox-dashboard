'use client'

import { useCanControl } from '@/components/can-control-provider'
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
import { Switch } from '@/components/ui/switch'
import { Loader2, Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

export type ConfValue = string | number | boolean | null

export type SshConfFieldDef =
	| { key: string; type: 'boolean'; label: string; description?: string }
	| { key: string; type: 'int'; label: string; description?: string }
	| { key: string; type: 'string'; label: string; placeholder?: string; description?: string }
	| {
			key: string
			type: 'enum'
			label: string
			options: { value: string; label: string }[]
			description?: string
	  }

export type SshConfChrome = {
	save: string
	saved: string
	saveFailed: string
	needsRestart: string
	restart: string
	restartTriggered: string
	restartFailed: string
	pending: string
	none: string
}

type Props = {
	endpoint: string
	fields: SshConfFieldDef[]
	initial: Record<string, ConfValue>
	chrome: SshConfChrome
}

export function SshConfForm({ endpoint, fields, initial, chrome }: Props) {
	const canControl = useCanControl()
	const [draft, setDraft] = useState<Record<string, ConfValue>>(initial)
	const [saved, setSaved] = useState<Record<string, ConfValue>>(initial)
	const [saving, setSaving] = useState(false)

	const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
	const set = (key: string, value: ConfValue) => setDraft((d) => ({ ...d, [key]: value }))

	async function restartEs() {
		try {
			const res = await fetch('/api/system/frontend', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'restart' }),
			})
			if (!res.ok) throw new Error(String(res.status))
			toast.success(chrome.restartTriggered)
		} catch {
			toast.error(chrome.restartFailed)
		}
	}

	async function save() {
		setSaving(true)
		try {
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ values: draft }),
			})
			if (!res.ok) throw new Error(String(res.status))
			setSaved(draft)
			toast.success(chrome.saved, {
				description: chrome.needsRestart,
				action: { label: chrome.restart, onClick: () => void restartEs() },
			})
		} catch {
			toast.error(chrome.saveFailed)
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2">
				{fields.map((field) => (
					<FieldRow
						key={field.key}
						field={field}
						value={draft[field.key] ?? null}
						disabled={!canControl}
						onChange={(v) => set(field.key, v)}
					/>
				))}
			</div>

			{canControl && (
				<div className="bg-background/80 sticky bottom-0 flex items-center justify-end gap-3 border-t py-3 backdrop-blur">
					<span className="text-muted-foreground text-sm">
						{dirty ? chrome.pending : chrome.none}
					</span>
					<Button type="button" onClick={() => void save()} disabled={!dirty || saving}>
						{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
						{chrome.save}
					</Button>
				</div>
			)}
		</div>
	)
}

function FieldRow({
	field,
	value,
	disabled,
	onChange,
}: {
	field: SshConfFieldDef
	value: ConfValue
	disabled: boolean
	onChange: (v: ConfValue) => void
}) {
	const id = `cfg-${field.key}`

	if (field.type === 'boolean') {
		return (
			<div className="flex items-center justify-between gap-4 rounded-lg border p-3">
				<div className="space-y-0.5">
					<Label htmlFor={id} className="font-normal">
						{field.label}
					</Label>
					{field.description && (
						<p className="text-muted-foreground text-xs">{field.description}</p>
					)}
				</div>
				<Switch
					id={id}
					checked={Boolean(value)}
					disabled={disabled}
					onCheckedChange={(c) => onChange(c)}
				/>
			</div>
		)
	}

	if (field.type === 'enum') {
		return (
			<div className="flex flex-col gap-1.5 rounded-lg border p-3">
				<Label htmlFor={id} className="font-normal">
					{field.label}
				</Label>
				<Select
					value={value === null || value === undefined ? '' : String(value)}
					disabled={disabled}
					onValueChange={(v) => onChange(v)}
				>
					<SelectTrigger id={id}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{field.options.map((o) => (
							<SelectItem key={o.value} value={o.value}>
								{o.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		)
	}

	const isNumber = field.type === 'int'
	return (
		<div className="flex flex-col gap-1.5 rounded-lg border p-3">
			<Label htmlFor={id} className="font-normal">
				{field.label}
			</Label>
			<Input
				id={id}
				type={isNumber ? 'number' : 'text'}
				value={value === null || value === undefined ? '' : String(value)}
				placeholder={field.type === 'string' ? field.placeholder : undefined}
				disabled={disabled}
				onChange={(e) =>
					onChange(
						isNumber ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value,
					)
				}
			/>
		</div>
	)
}
