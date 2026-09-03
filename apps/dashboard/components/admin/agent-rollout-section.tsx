'use client'

import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

type FleetVersion = { version: string; boxes: number; seenLastHour: number }
type Rollout = {
	deployedVersion: string
	targetVersion: string
	rolloutPercent: number
	versions: FleetVersion[]
}

/** Paliers cliquables plutôt qu'un champ libre : les deux gestes d'urgence —
 * tout arrêter (0) et tout rapatrier (100) — deviennent atteignables en un clic. */
const STEPS = [0, 10, 25, 50, 100]

export function AgentRolloutSection() {
	const t = useTranslations('agentRollout')
	const [state, setState] = useState<Rollout | null>(null)
	const [saving, setSaving] = useState(false)

	const load = useCallback(async () => {
		try {
			const res = await fetch('/api/agent-rollout')
			if (!res.ok) throw new Error()
			setState(await res.json())
		} catch {
			toast.error(t('loadError'))
		}
	}, [t])

	useEffect(() => {
		void load()
	}, [load])

	async function save(patch: { targetVersion?: string; rolloutPercent?: number }) {
		setSaving(true)
		try {
			const res = await fetch('/api/agent-rollout', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch),
			})
			if (!res.ok) throw new Error()
			toast.success(t('saved'))
			await load()
		} catch {
			toast.error(t('saveError'))
		} finally {
			setSaving(false)
		}
	}

	if (!state) return null

	// La liste des cibles se construit à partir de ce qui existe réellement :
	// la version déployée, plus toute version qu'au moins une box déclare.
	const targets = [...new Set([state.deployedVersion, ...state.versions.map((v) => v.version)])]

	return (
		<section className="space-y-4 border rounded-lg p-4">
			<h2 className="font-medium">{t('heading')}</h2>
			<p className="text-sm text-muted-foreground">
				{t('deployed', { version: state.deployedVersion })}
			</p>

			<div className="space-y-1">
				<label className="text-xs text-muted-foreground" htmlFor="agent-target">
					{t('target')}
				</label>
				<select
					id="agent-target"
					className="block rounded border bg-background px-2 py-1 text-sm"
					value={state.targetVersion}
					disabled={saving}
					onChange={(e) => void save({ targetVersion: e.target.value })}
				>
					{targets.map((v) => (
						<option key={v} value={v}>
							{v}
						</option>
					))}
				</select>
			</div>

			<div className="space-y-1">
				<span className="block text-xs text-muted-foreground">{t('percent')}</span>
				<div className="flex gap-2">
					{STEPS.map((step) => (
						<Button
							key={step}
							type="button"
							size="sm"
							variant={state.rolloutPercent === step ? 'default' : 'outline'}
							disabled={saving}
							onClick={() => void save({ rolloutPercent: step })}
						>
							{step}
						</Button>
					))}
				</div>
			</div>

			{state.versions.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t('empty')}</p>
			) : (
				<table className="w-full text-sm">
					<thead>
						<tr className="text-left text-xs text-muted-foreground">
							<th className="font-normal">{t('colVersion')}</th>
							<th className="font-normal">{t('colBoxes')}</th>
							<th className="font-normal">{t('colSeen')}</th>
						</tr>
					</thead>
					<tbody>
						{state.versions.map((v) => (
							<tr key={v.version}>
								<td>{v.version}</td>
								<td>{v.boxes}</td>
								<td>{v.seenLastHour}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</section>
	)
}
