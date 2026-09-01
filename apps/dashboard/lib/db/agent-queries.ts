import { randomUUID } from 'node:crypto'
import { generateAgentToken, hashAgentToken } from '@/lib/agent/token'
import type { DB } from '@/lib/db'
import { agentTokens } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { after } from 'next/server'

export type AgentTokenRow = typeof agentTokens.$inferSelect

/** Name given to tokens minted by the installer zip route (`installer/route.ts`). */
export const INSTALLER_TOKEN_NAME = 'installeur'

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
	agentVersion?: string | null,
): Promise<{ recalboxId: string; tokenId: string } | null> {
	const row = await db
		.select({
			id: agentTokens.id,
			recalboxId: agentTokens.recalboxId,
			revokedAt: agentTokens.revokedAt,
			lastUsedAt: agentTokens.lastUsedAt,
		})
		.from(agentTokens)
		.where(eq(agentTokens.tokenHash, hashAgentToken(rawToken)))
		.get()
	if (!row || row.revokedAt) return null

	// A null `lastUsedAt` means this is the token's FIRST successful check-in — the
	// only instant the server can know, with certainty, which minted token is the
	// one actually deployed on the box. That is the safe & complete moment to clean
	// up sibling installer tokens (see `cleanupOnFirstUse` below).
	const isFirstCheckIn = row.lastUsedAt == null

	// `lastUsedAt` is the box-liveness signal: buildSeedState derives online/offline
	// from it, so a lost write makes a live box read as offline in the UI. It used to
	// be a floating promise, which a serverless platform may drop the moment the
	// response flushes. `after()` hands the write to the platform, which keeps the
	// invocation alive until it settles — without delaying the response.
	try {
		after(() => cleanupOnFirstUse(db, row.id, row.recalboxId, isFirstCheckIn, agentVersion))
	} catch {
		// `after()` throws outside a request scope (tests, one-shot scripts, the
		// scrobbler). There is no platform to defer to there, so write inline rather
		// than drop the touch. The callback form above means nothing ran yet.
		await cleanupOnFirstUse(db, row.id, row.recalboxId, isFirstCheckIn, agentVersion)
	}

	return { recalboxId: row.recalboxId, tokenId: row.id }
}

/**
 * Deferred work run on every check-in: always touches `lastUsedAt`, and on the
 * FIRST check-in only, also revokes sibling unused installer tokens. Both steps
 * are best-effort — this runs from `after()` (or inline as its fallback), never
 * on the response path, and must never fail the agent's request.
 */
async function cleanupOnFirstUse(
	db: DB,
	tokenId: string,
	recalboxId: string,
	isFirstCheckIn: boolean,
	agentVersion?: string | null,
): Promise<void> {
	await touchLastUsed(db, tokenId, agentVersion)
	if (isFirstCheckIn) {
		await revokeSiblingInstallerTokens(db, recalboxId, tokenId)
	}
}

/** Best-effort liveness touch: never let a failed write break the caller's request. */
async function touchLastUsed(db: DB, tokenId: string, agentVersion?: string | null): Promise<void> {
	try {
		// Une requête SANS en-tête n'efface pas une version déjà connue : un agent
		// qui déclare sa version sur sa boucle de commandes ne la répète pas
		// forcément partout, et écraser avec `null` ferait clignoter le tableau
		// de déploiement.
		const patch: { lastUsedAt: Date; agentVersion?: string } = { lastUsedAt: new Date() }
		if (agentVersion) patch.agentVersion = agentVersion
		await db.update(agentTokens).set(patch).where(eq(agentTokens.id, tokenId))
	} catch (err) {
		logger.error('[agent] lastUsedAt touch failed', err)
	}
}

/**
 * Revoke every OTHER never-used `installeur` token for this Recalbox. Called only
 * from a token's first check-in (see `resolveAgentToken`): at that instant the box
 * that just talked to us is unambiguously the one running THIS token, so any other
 * unused installer token for the same box is a stale artifact of an earlier
 * download (lost zip, retried drag-and-drop, a second computer) — safe and
 * complete to revoke now, unlike at download time, when the server cannot tell a
 * token already deployed on the box from one that was merely minted.
 */
async function revokeSiblingInstallerTokens(
	db: DB,
	recalboxId: string,
	exceptTokenId: string,
): Promise<void> {
	try {
		const siblings = await db
			.select({ id: agentTokens.id })
			.from(agentTokens)
			.where(
				and(
					eq(agentTokens.recalboxId, recalboxId),
					eq(agentTokens.name, INSTALLER_TOKEN_NAME),
					isNull(agentTokens.lastUsedAt),
					isNull(agentTokens.revokedAt),
				),
			)
			.all()
		await Promise.all(
			siblings.filter((s) => s.id !== exceptTokenId).map((s) => revokeAgentToken(db, s.id)),
		)
	} catch (err) {
		logger.error('[agent] sibling installer token cleanup failed', err)
	}
}

export async function listAgentTokens(db: DB, recalboxId: string): Promise<AgentTokenRow[]> {
	return db.select().from(agentTokens).where(eq(agentTokens.recalboxId, recalboxId)).all()
}

export async function revokeAgentToken(db: DB, id: string): Promise<void> {
	await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.id, id))
}
