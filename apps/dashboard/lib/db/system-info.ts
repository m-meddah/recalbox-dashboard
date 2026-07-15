import type { DB } from '@/lib/db'
import { systemSnapshots } from '@/lib/db/schema'
import type { SystemInfoEvent } from '@/lib/recalbox/events'
import { sql } from 'drizzle-orm'

export type SnapshotRow = typeof systemSnapshots.$inferSelect

/**
 * Latest snapshot per Recalbox (autoincrement `id` ⇒ most recent row). Used in
 * serverless mode to drive the live `system:info` SSE event from agent-pushed
 * snapshots, since the cloud has no MQTT link to read CPU/temp directly.
 */
export async function getLatestSnapshots(db: DB): Promise<Map<string, SnapshotRow>> {
	const rows = await db
		.select()
		.from(systemSnapshots)
		.where(
			sql`${systemSnapshots.id} IN (SELECT max(id) FROM system_snapshots GROUP BY recalbox_id)`,
		)
		.all()
	const map = new Map<string, SnapshotRow>()
	for (const row of rows) {
		if (row.recalboxId) map.set(row.recalboxId, row)
	}
	return map
}

/** Reconstruct a `system:info` event from a stored snapshot (nulls → 0). */
export function snapshotToSystemInfo(row: SnapshotRow): SystemInfoEvent {
	return {
		type: 'system:info',
		timestamp: row.capturedAt.toISOString(),
		cpuPercent: row.cpuPercent ?? 0,
		memUsedMb: row.memUsedMb ?? 0,
		memTotalMb: row.memTotalMb ?? 0,
		tempCelsius: row.tempCelsius ?? 0,
		uptimeSeconds: row.uptimeSeconds ?? undefined,
		storage: row.storage ?? undefined,
	}
}
