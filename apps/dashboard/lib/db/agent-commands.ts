import { randomUUID } from 'node:crypto'
import type { DB } from '@/lib/db'
import { agentCommands } from '@/lib/db/schema'
import { and, desc, eq, inArray } from 'drizzle-orm'

export type AgentCommandRow = typeof agentCommands.$inferSelect

/** Queue a remote-control command for a Recalbox. */
export async function enqueueCommand(
	db: DB,
	recalboxId: string,
	type: string,
	payload: Record<string, unknown>,
	createdBy?: string | null,
): Promise<AgentCommandRow> {
	const rows = await db
		.insert(agentCommands)
		.values({
			id: randomUUID(),
			recalboxId,
			type,
			payload,
			status: 'pending',
			createdBy: createdBy ?? null,
			createdAt: new Date(),
		})
		.returning()
	const row = rows[0]
	if (!row) throw new Error('Failed to enqueue command')
	return row
}

/**
 * Hand the agent all pending commands for its Recalbox and atomically mark them
 * claimed so each is delivered exactly once. A single agent polls per box, so
 * there is no real contention on the claim.
 */
export async function claimPendingCommands(db: DB, recalboxId: string): Promise<AgentCommandRow[]> {
	const pending = await db
		.select()
		.from(agentCommands)
		.where(and(eq(agentCommands.recalboxId, recalboxId), eq(agentCommands.status, 'pending')))
		.all()
	if (pending.length === 0) return []

	const ids = pending.map((c) => c.id)
	const now = new Date()
	await db
		.update(agentCommands)
		.set({ status: 'claimed', claimedAt: now })
		.where(inArray(agentCommands.id, ids))

	return pending.map((c) => ({ ...c, status: 'claimed', claimedAt: now }))
}

/**
 * Record a command's outcome. Scoped to the agent's Recalbox so an agent can
 * only complete its own box's commands. Returns false when no such command
 * exists for that Recalbox.
 */
export async function completeCommand(
	db: DB,
	recalboxId: string,
	id: string,
	ok: boolean,
	result?: string | null,
): Promise<boolean> {
	const updated = await db
		.update(agentCommands)
		.set({ status: ok ? 'done' : 'failed', completedAt: new Date(), result: result ?? null })
		.where(and(eq(agentCommands.id, id), eq(agentCommands.recalboxId, recalboxId)))
		.returning({ id: agentCommands.id })
	return updated.length > 0
}

/** Recent commands for a Recalbox, newest first (for history/status UI). */
export async function listCommands(
	db: DB,
	recalboxId: string,
	limit = 50,
): Promise<AgentCommandRow[]> {
	return db
		.select()
		.from(agentCommands)
		.where(eq(agentCommands.recalboxId, recalboxId))
		.orderBy(desc(agentCommands.createdAt))
		.limit(limit)
		.all()
}
