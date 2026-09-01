import { readAgentVersion } from '@/lib/agent/payload'
import { getAllSettings, upsertSetting } from '@/lib/db/queries'

export const TARGET_VERSION_KEY = 'agent.targetVersion'
export const ROLLOUT_PERCENT_KEY = 'agent.rolloutPercent'

export type RolloutSettings = {
	/** Version que le parc doit exécuter. Par défaut, celle du déploiement. */
	targetVersion: string
	/** Part des box `stable` à qui la cible est annoncée. Fermé par défaut. */
	rolloutPercent: number
}

/**
 * Les deux réglages de déploiement, avec leurs défauts.
 *
 * `getAllSettings()` lit toute la table : elle compte quelques dizaines de
 * lignes, et un balayage y coûte moins qu'une abstraction de cache de plus sur
 * un chemin déjà court.
 */
export async function readRolloutSettings(): Promise<RolloutSettings> {
	const [rows, deployed] = await Promise.all([getAllSettings(), readAgentVersion()])
	return {
		targetVersion: rows[TARGET_VERSION_KEY]?.trim() || deployed,
		rolloutPercent: clampPercent(rows[ROLLOUT_PERCENT_KEY]),
	}
}

export async function writeRolloutSettings(patch: Partial<RolloutSettings>): Promise<void> {
	if (patch.targetVersion !== undefined) {
		await upsertSetting(TARGET_VERSION_KEY, patch.targetVersion)
	}
	if (patch.rolloutPercent !== undefined) {
		await upsertSetting(ROLLOUT_PERCENT_KEY, String(clampPercent(String(patch.rolloutPercent))))
	}
}

/** Une valeur illisible vaut 0 : le défaut sûr est « personne ne bascule ». */
function clampPercent(raw: string | undefined): number {
	const n = Number.parseInt(raw ?? '', 10)
	if (Number.isNaN(n)) return 0
	return Math.min(100, Math.max(0, n))
}
