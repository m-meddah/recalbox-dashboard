import type { DB } from '@/lib/db'
import { games, sessions } from '@/lib/db/schema'
import { classifySession } from '@/lib/sessions/classify'
import { and, eq } from 'drizzle-orm'

export type AgentSessionInput = {
	startedAt: Date
	endedAt: Date
	durationSeconds: number
	system: string
	romPath: string
	gameName?: string | null
	autoClosed?: boolean
	closedReason?: string | null
}

export type IngestResult = { created: boolean; sessionId: number }

/**
 * Persist one finished play session pushed by the on-device agent. The agent
 * already pairs start/stop and drops sub-minimum sessions on the device, so this
 * just finalizes the way the scrobbler does: resolves the gameId from the rom
 * path, classifies by duration, and inserts.
 *
 * Idempotent: the agent buffers and retries, so the same session can arrive more
 * than once. A push matching an existing (recalbox, rom, start instant) row is
 * treated as a duplicate and returns that row instead of inserting again.
 */
export async function ingestAgentSession(
	db: DB,
	recalboxId: string,
	input: AgentSessionInput,
): Promise<IngestResult> {
	const existing = await db
		.select({ id: sessions.id })
		.from(sessions)
		.where(
			and(
				eq(sessions.recalboxId, recalboxId),
				eq(sessions.romPath, input.romPath),
				eq(sessions.startedAt, input.startedAt),
			),
		)
		.get()
	if (existing) return { created: false, sessionId: existing.id }

	// Link to the collection game when possible (same match the scrobbler uses).
	const game = await db
		.select({ id: games.id })
		.from(games)
		.where(and(eq(games.romPath, input.romPath), eq(games.recalboxId, recalboxId)))
		.get()

	const rows = await db
		.insert(sessions)
		.values({
			recalboxId,
			gameId: game?.id ?? null,
			startedAt: input.startedAt,
			endedAt: input.endedAt,
			durationSeconds: input.durationSeconds,
			system: input.system,
			romPath: input.romPath,
			source: 'agent',
			durationConfidence: 'measured',
			autoClosed: input.autoClosed ?? false,
			closedReason: input.closedReason ?? null,
			classification: classifySession(input.durationSeconds),
		})
		.returning({ id: sessions.id })

	const row = rows[0]
	if (!row) throw new Error('Failed to insert agent session')
	return { created: true, sessionId: row.id }
}
