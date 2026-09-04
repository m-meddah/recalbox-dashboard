import { createHash } from 'node:crypto'
import { compareVersions } from '@/lib/agent/version'

export type AgentChannel = 'stable' | 'beta'

export type RolloutInput = {
	channel: AgentChannel
	recalboxId: string
	/** Ce que la box déclare exécuter, via `X-Agent-Version`. */
	currentVersion: string | null
	targetVersion: string
	rolloutPercent: number
}

/**
 * Seau de 0 à 99, déterministe. Un tirage aléatoire à chaque interrogation
 * ferait osciller les box entre deux versions toutes les 60 secondes ; le
 * hachage garantit qu'une box tirée dans les 10 % y reste à 25 %.
 */
export function bucketFor(recalboxId: string): number {
	return createHash('sha256').update(recalboxId).digest().readUInt32BE(0) % 100
}

/**
 * La version que cette box doit exécuter, ou `null` quand le cloud n'a rien à
 * lui dire — auquel cas elle garde ce qu'elle exécute.
 */
export function resolveTargetVersion(input: RolloutInput): string | null {
	const { channel, recalboxId, currentVersion, targetVersion, rolloutPercent } = input

	// Sans point de départ on ne peut pas distinguer une montée d'une descente,
	// et un agent trop ancien pour déclarer sa version est de toute façon trop
	// ancien pour comprendre le champ qu'on lui renverrait.
	if (!currentVersion) return null

	const cmp = compareVersions(targetVersion, currentVersion)
	if (cmp === 0) return null

	// Le pourcentage protège une montée ; une descente n'a pas besoin d'être
	// protégée, elle EST la protection. Sans cette ligne, rapatrier le parc
	// demanderait deux gestes coordonnés — et un bouton d'urgence qui demande
	// deux gestes n'en est pas un.
	if (cmp < 0) return targetVersion

	if (channel === 'beta') return targetVersion
	if (bucketFor(recalboxId) < rolloutPercent) return targetVersion
	return null
}
