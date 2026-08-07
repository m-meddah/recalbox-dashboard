import { randomUUID } from 'node:crypto'
import { generateAgentToken, hashAgentToken } from '@/lib/agent/token'
import type { DB } from '@/lib/db'
import { agentTokens } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { eq } from 'drizzle-orm'
import { after } from 'next/server'

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

	// `lastUsedAt` is the box-liveness signal: buildSeedState derives online/offline
	// from it, so a lost write makes a live box read as offline in the UI. It used to
	// be a floating promise, which a serverless platform may drop the moment the
	// response flushes. `after()` hands the write to the platform, which keeps the
	// invocation alive until it settles — without delaying the response.
	try {
		after(() => touchLastUsed(db, row.id))
	} catch {
		// `after()` throws outside a request scope (tests, one-shot scripts, the
		// scrobbler). There is no platform to defer to there, so write inline rather
		// than drop the touch. The callback form above means nothing ran yet.
		await touchLastUsed(db, row.id)
	}

	return { recalboxId: row.recalboxId, tokenId: row.id }
}

/** Best-effort liveness touch: never let a failed write break the caller's request. */
async function touchLastUsed(db: DB, tokenId: string): Promise<void> {
	try {
		await db.update(agentTokens).set({ lastUsedAt: new Date() }).where(eq(agentTokens.id, tokenId))
	} catch (err) {
		logger.error('[agent] lastUsedAt touch failed', err)
	}
}

export async function listAgentTokens(db: DB, recalboxId: string): Promise<AgentTokenRow[]> {
	return db.select().from(agentTokens).where(eq(agentTokens.recalboxId, recalboxId)).all()
}

export async function revokeAgentToken(db: DB, id: string): Promise<void> {
	await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.id, id))
}
