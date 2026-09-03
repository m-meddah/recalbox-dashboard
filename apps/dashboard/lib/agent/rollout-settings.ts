import { readAgentVersion } from '@/lib/agent/payload'
import { getAllSettings, upsertSetting } from '@/lib/db/queries'

export const TARGET_VERSION_KEY = 'agent.targetVersion'
export const ROLLOUT_PERCENT_KEY = 'agent.rolloutPercent'
export const PREVIOUS_TARGET_VERSION_KEY = 'agent.previousTargetVersion'

export type RolloutSettings = {
	/** Version que le parc doit exécuter. Par défaut, celle du déploiement. */
	targetVersion: string
	/** Part des box `stable` à qui la cible est annoncée. Fermé par défaut. */
	rolloutPercent: number
	/**
	 * Cible précédente, ou `null` si la cible n'a jamais bougé.
	 *
	 * C'est le bouton « rapatrier tout le monde ». L'ensemble des cibles
	 * autorisées se construit à partir de la télémétrie ; une fois le
	 * déploiement à 100 %, plus aucune box ne déclare la version d'avant, donc
	 * elle cesse d'être une cible légale — alors que chaque box la garde dans
	 * son `backup/` et pourrait y revenir en quelques secondes. Le levier
	 * disparaîtrait exactement au moment où l'on découvre qu'une version
	 * démarre bien et se comporte mal. On mémorise donc la sortante.
	 */
	previousTargetVersion: string | null
}

/** Ce qu'un administrateur peut écrire. `previousTargetVersion` est dérivée. */
export type RolloutPatch = Partial<Pick<RolloutSettings, 'targetVersion' | 'rolloutPercent'>>

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
		previousTargetVersion: rows[PREVIOUS_TARGET_VERSION_KEY]?.trim() || null,
	}
}

export async function writeRolloutSettings(patch: RolloutPatch): Promise<void> {
	if (patch.targetVersion !== undefined) {
		// La cible sortante devient la marche arrière. Écrite avant la nouvelle
		// cible, et seulement quand la valeur change : réenregistrer la même
		// cible ne doit pas écraser la marche arrière par elle-même.
		const current = await readRolloutSettings()
		if (patch.targetVersion !== current.targetVersion) {
			await upsertSetting(PREVIOUS_TARGET_VERSION_KEY, current.targetVersion)
		}
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
