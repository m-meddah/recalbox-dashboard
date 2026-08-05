import type { DB } from '@/lib/db'
import { agentTokens } from '@/lib/db/schema'
import { isNull, sql } from 'drizzle-orm'
import { cache } from 'react'

/** An agent is considered "online" if it was seen within this window. The agent
 * polls the command queue every ~10s, so its token's lastUsedAt stays fresh. */
export const AGENT_LIVENESS_MS = 120_000

/**
 * Last time each Recalbox's agent was seen, from its token's `lastUsedAt` (touched
 * on every authenticated agent request — the most reliable liveness signal). Used
 * to drive connection status in serverless mode, where the cloud has no MQTT link.
 *
 * Wrapped in React's `cache()` so the layout's `buildSeedState` call and the home
 * page's own call dedupe within the same render pass instead of querying twice.
 */
export const getAgentLastSeen = cache(async (db: DB): Promise<Map<string, Date>> => {
	const rows = await db
		.select({
			recalboxId: agentTokens.recalboxId,
			max: sql<number | null>`max(${agentTokens.lastUsedAt})`,
		})
		.from(agentTokens)
		.where(isNull(agentTokens.revokedAt))
		.groupBy(agentTokens.recalboxId)
		.all()
	const map = new Map<string, Date>()
	for (const r of rows) {
		// lastUsedAt is stored as a Unix-seconds timestamp (drizzle `mode: 'timestamp'`).
		if (r.recalboxId && r.max) map.set(r.recalboxId, new Date(r.max * 1000))
	}
	return map
})
