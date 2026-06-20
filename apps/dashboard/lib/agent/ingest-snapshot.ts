import type { DB } from '@/lib/db'
import { systemSnapshots } from '@/lib/db/schema'

export type AgentSnapshotInput = {
	capturedAt: Date
	cpuPercent?: number | null
	memUsedMb?: number | null
	memTotalMb?: number | null
	tempCelsius?: number | null
	uptimeSeconds?: number | null
}

/**
 * Persist one system snapshot pushed by the on-device agent. Mirrors what the
 * SSH stats collector used to write into system_snapshots — just sourced from
 * the agent's local /proc + /sys reads instead of remote commands.
 */
export async function ingestSnapshot(
	db: DB,
	recalboxId: string,
	input: AgentSnapshotInput,
): Promise<{ id: number }> {
	const rows = await db
		.insert(systemSnapshots)
		.values({
			recalboxId,
			capturedAt: input.capturedAt,
			cpuPercent: input.cpuPercent ?? null,
			memUsedMb: input.memUsedMb ?? null,
			memTotalMb: input.memTotalMb ?? null,
			tempCelsius: input.tempCelsius ?? null,
			uptimeSeconds: input.uptimeSeconds ?? null,
		})
		.returning({ id: systemSnapshots.id })
	const row = rows[0]
	if (!row) throw new Error('Failed to insert snapshot')
	return { id: row.id }
}
