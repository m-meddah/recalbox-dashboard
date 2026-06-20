import { randomUUID } from 'node:crypto'
import { generateAgentToken, hashAgentToken } from '@/lib/agent/token'
import type { DB } from '@/lib/db'
import { agentTokens } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export type AgentTokenRow = typeof agentTokens.$inferSelect

/**
 * Mint a new agent token for a Recalbox. Returns the RAW token, which is shown
 * once and never recoverable afterwards (only its hash is stored).
 */
export async function createAgentToken(
	db: DB,
	recalboxId: string,
	name?: string,
): Promise<{ token: string; row: AgentTokenRow }> {
	const { token, tokenHash } = generateAgentToken()
	const rows = await db
		.insert(agentTokens)
		.values({
			id: randomUUID(),
			recalboxId,
			tokenHash,
			name: name ?? null,
			createdAt: new Date(),
		})
		.returning()
	const row = rows[0]
	if (!row) throw new Error('Failed to create agent token')
	return { token, row }
}

/**
 * Resolve a raw agent token to its Recalbox. Returns null when the token is
 * unknown or revoked. Touches lastUsedAt best-effort (never blocks/fails the
 * caller on it).
 */
export async function resolveAgentToken(
	db: DB,
	rawToken: string,
): Promise<{ recalboxId: string; tokenId: string } | null> {
	const row = await db
		.select({
			id: agentTokens.id,
			recalboxId: agentTokens.recalboxId,
			revokedAt: agentTokens.revokedAt,
		})
		.from(agentTokens)
		.where(eq(agentTokens.tokenHash, hashAgentToken(rawToken)))
		.get()
	if (!row || row.revokedAt) return null

	void (async () => {
		try {
			await db.update(agentTokens).set({ lastUsedAt: new Date() }).where(eq(agentTokens.id, row.id))
		} catch {}
	})()

	return { recalboxId: row.recalboxId, tokenId: row.id }
}

export async function listAgentTokens(db: DB, recalboxId: string): Promise<AgentTokenRow[]> {
	return db.select().from(agentTokens).where(eq(agentTokens.recalboxId, recalboxId)).all()
}

export async function revokeAgentToken(db: DB, id: string): Promise<void> {
	await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.id, id))
}
