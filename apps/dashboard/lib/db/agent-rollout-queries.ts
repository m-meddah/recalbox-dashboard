import type { AgentChannel } from '@/lib/agent/rollout'
import { compareVersions } from '@/lib/agent/version'
import type { DB } from '@/lib/db'
import { agentTokens, recalboxes } from '@/lib/db/schema'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'

/**
 * Canal de déploiement d'une box. Une lecture par clé primaire, ajoutée à la
 * boucle de commandes : c'est la seule requête que ce mécanisme ajoute au
 * chemin de réponse, et `stable` est le défaut sûr en cas de doute.
 */
export async function readAgentChannel(db: DB, recalboxId: string): Promise<AgentChannel> {
	const row = await db
		.select({ channel: recalboxes.agentChannel })
		.from(recalboxes)
		.where(eq(recalboxes.id, recalboxId))
		.get()
	return row?.channel === 'beta' ? 'beta' : 'stable'
}

export type FleetVersionRow = {
	version: string
	boxes: number
	/** Box de cette version ayant donné signe de vie dans la dernière heure. */
	seenLastHour: number
}

const LIVENESS_WINDOW_MS = 60 * 60 * 1000

/**
 * Répartition des versions dans le parc — la seule vue qui compte pendant un
 * déploiement : une version dont le taux de présence s'effondre est une version
 * à rapatrier.
 *
 * L'agrégation se fait en JavaScript plutôt qu'en SQL : le parc tient en
 * quelques dizaines de lignes, et une box qui porte plusieurs jetons (une
 * réinstallation en laisse) ne doit compter qu'une fois — une règle plus claire
 * à lire ici qu'en `count(distinct case when …)`.
 */
export async function readFleetVersions(db: DB): Promise<FleetVersionRow[]> {
	const rows = await db
		.select({
			recalboxId: agentTokens.recalboxId,
			version: agentTokens.agentVersion,
			lastUsedAt: agentTokens.lastUsedAt,
		})
		.from(agentTokens)
		.where(and(isNull(agentTokens.revokedAt), isNotNull(agentTokens.agentVersion)))
		.all()

	const latest = new Map<string, { version: string; at: number }>()
	for (const row of rows) {
		if (!row.version) continue
		const at = row.lastUsedAt?.getTime() ?? 0
		const seen = latest.get(row.recalboxId)
		if (!seen || at > seen.at) latest.set(row.recalboxId, { version: row.version, at })
	}

	const cutoff = Date.now() - LIVENESS_WINDOW_MS
	const byVersion = new Map<string, { boxes: number; seenLastHour: number }>()
	for (const { version, at } of latest.values()) {
		const acc = byVersion.get(version) ?? { boxes: 0, seenLastHour: 0 }
		acc.boxes += 1
		if (at >= cutoff) acc.seenLastHour += 1
		byVersion.set(version, acc)
	}

	return [...byVersion.entries()]
		.map(([version, acc]) => ({ version, ...acc }))
		.sort((a, b) => compareVersions(b.version, a.version))
}
