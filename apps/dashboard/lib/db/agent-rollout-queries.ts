import type { AgentChannel } from '@/lib/agent/rollout'
import type { DB } from '@/lib/db'
import { recalboxes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

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
