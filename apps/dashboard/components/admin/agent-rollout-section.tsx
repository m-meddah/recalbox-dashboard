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
	previousTargetVersion: string | null
	versions: FleetVersion[]
}

/** Paliers cliquables plutôt qu'un champ libre : les deux gestes d'urgence —
 * tout arrêter (0) et tout rapatrier (100) — deviennent atteignables en un clic. */
const STEPS = [0, 10, 25, 50, 100]

export function AgentRolloutSection() {
	const t = useTranslations('agentRollout')
	const [state, setState] = useState<Rollout | null>(null)
	const [loadError, setLoadError] = useState(false)
	const [saving, setSaving] = useState(false)

	const load = useCallback(async () => {
		try {
			const res = await fetch('/api/agent-rollout')
			if (!res.ok) throw new Error()
			setState(await res.json())
			setLoadError(false)
		} catch {
			setLoadError(true)
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

	if (!state) {
		if (!loadError) return null
		// Un panneau vide ne dit rien : pendant un incident, l'absence de
		// signal est indiscernable d'un "rien à signaler". Une erreur explicite
		// avec une reprise en un clic reste lisible et opérable.
		return (
			<section className="space-y-4 border rounded-lg p-4">
				<h2 className="font-medium">{t('heading')}</h2>
				<p className="text-sm text-destructive">{t('loadError')}</p>
				<Button type="button" size="sm" variant="outline" onClick={() => void load()}>
					{t('retry')}
				</Button>
			</section>
		)
	}

	// La liste des cibles se construit à partir de ce qui existe réellement :
	// la version déployée, la cible déjà enregistrée (même si plus aucune box
	// ne la déclare), la cible PRÉCÉDENTE — le bouton de rapatriement, qui doit
	// rester offert une fois le déploiement à 100 %, quand plus aucune box ne
	// déclare la version d'avant — plus toute version qu'au moins une box
	// déclare. Sans la cible déjà enregistrée, le select pourrait afficher une
	// valeur qu'il n'offre pas — exactement le mensonge qu'il existe pour
	// empêcher.
	const targets = [
		...new Set(
			[
				state.deployedVersion,
				state.targetVersion,
				state.previousTargetVersion,
				...state.versions.map((v) => v.version),
			].filter((v): v is string => Boolean(v)),
		),
	]

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
				<fieldset className="m-0 flex gap-2 border-0 p-0" aria-label={t('percent')}>
					{STEPS.map((step) => (
						<Button
							key={step}
							type="button"
							size="sm"
							variant={state.rolloutPercent === step ? 'default' : 'outline'}
							aria-pressed={state.rolloutPercent === step}
							disabled={saving}
							onClick={() => void save({ rolloutPercent: step })}
						>
							{step}
						</Button>
					))}
				</fieldset>
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
