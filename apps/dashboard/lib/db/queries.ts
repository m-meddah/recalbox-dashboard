import { gte } from 'drizzle-orm'
import { db } from '@/lib/db/index'
import { systemSnapshots } from '@/lib/db/schema'
import type { SystemStats } from '@/lib/recalbox/system-stats'

/** Insert a system stats snapshot into the database. */
export async function insertSystemSnapshot(stats: SystemStats): Promise<void> {
	await db.insert(systemSnapshots).values({
		capturedAt: stats.takenAt,
		cpuPercent: stats.cpuUsage,
		memUsedMb: stats.ramUsedMb,
		memTotalMb: stats.ramTotalMb,
		tempCelsius: stats.cpuTemp,
		uptimeSeconds: stats.uptimeSec !== null ? Math.round(stats.uptimeSec) : null,
	})
}

/** Retrieve system snapshots from the last N minutes. */
export async function getRecentSnapshots(minutes: number) {
	const since = new Date(Date.now() - minutes * 60 * 1000)
	return db
		.select()
		.from(systemSnapshots)
		.where(gte(systemSnapshots.capturedAt, since))
		.orderBy(systemSnapshots.capturedAt)
}
