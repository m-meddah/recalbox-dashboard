import { eq, isNull, sql } from 'drizzle-orm'
import type { DB } from '@/lib/db/index'
import { sessions } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'

const MIN_DURATION_SEC = parseInt(process.env['SCROBBLE_MIN_DURATION_SEC'] ?? '10', 10)
const MAX_DURATION_SEC = 3600

type OpenSession = typeof sessions.$inferSelect

export class SessionManager {
	constructor(private readonly db: DB) {}

	private async getOpen(): Promise<OpenSession[]> {
		return this.db.select().from(sessions).where(isNull(sessions.endedAt))
	}

	private async insert(opts: { startedAt: Date; system: string; romPath: string }): Promise<number> {
		const rows = await this.db
			.insert(sessions)
			.values({ startedAt: opts.startedAt, system: opts.system, romPath: opts.romPath })
			.returning({ id: sessions.id })
		const row = rows[0]
		if (!row) throw new Error('Failed to insert session')
		return row.id
	}

	private async close(
		id: number,
		endedAt: Date,
		durationSeconds: number,
		opts?: { autoClosed?: boolean; closedReason?: string },
	): Promise<void> {
		await this.db
			.update(sessions)
			.set({
				endedAt,
				durationSeconds,
				autoClosed: opts?.autoClosed ?? false,
				closedReason: opts?.closedReason ?? null,
			})
			.where(eq(sessions.id, id))
	}

	private async remove(id: number): Promise<void> {
		await this.db.delete(sessions).where(eq(sessions.id, id))
	}

	async openSession(event: GameStartEvent): Promise<void> {
		const open = await this.getOpen()

		for (const existing of open) {
			const durationSec = Math.round((event.startedAt.getTime() - existing.startedAt.getTime()) / 1000)
			if (durationSec < MIN_DURATION_SEC) {
				await this.remove(existing.id)
				logger.info(`Deleted short auto-closed session ${existing.id} (${durationSec}s) for ${existing.romPath}`)
			} else {
				await this.close(existing.id, event.startedAt, durationSec, {
					autoClosed: true,
					closedReason: 'new_session_started',
				})
				logger.info(`Auto-closed session ${existing.id} (${durationSec}s) for ${existing.romPath}`)
			}
		}

		const id = await this.insert({ startedAt: event.startedAt, system: event.system, romPath: event.romPath })
		logger.info(`Opened session ${id} for ${event.romPath} on ${event.system}`)
	}

	async closeSession(event: GameStopEvent): Promise<void> {
		const open = await this.getOpen()
		const match = open.find((s) => s.romPath === event.romPath)

		if (!match) {
			logger.info(`No open session found for ${event.romPath}, ignoring stop event`)
			return
		}

		const durationSec = Math.round((event.stoppedAt.getTime() - match.startedAt.getTime()) / 1000)

		if (durationSec < MIN_DURATION_SEC) {
			await this.remove(match.id)
			logger.info(`Deleted short session ${match.id} (${durationSec}s) for ${event.romPath}`)
			return
		}

		await this.close(match.id, event.stoppedAt, durationSec)
		logger.info(`Closed session ${match.id} (${durationSec}s) for ${event.romPath}`)
	}

	async recoverOrphanSessions(maxAgeHours = 12): Promise<number> {
		const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000)
		const open = await this.getOpen()
		const orphans = open.filter((s) => s.startedAt < cutoff)

		for (const session of orphans) {
			const rawDuration = Math.round((Date.now() - session.startedAt.getTime()) / 1000)
			const durationSec = Math.min(rawDuration, MAX_DURATION_SEC)

			if (durationSec < MIN_DURATION_SEC) {
				await this.remove(session.id)
				logger.info(`Deleted orphan session ${session.id} (too short) for ${session.romPath}`)
			} else {
				const endedAt = new Date(session.startedAt.getTime() + durationSec * 1000)
				await this.close(session.id, endedAt, durationSec, { closedReason: 'orphan_recovery' })
				logger.info(`Recovered orphan session ${session.id} (${durationSec}s capped) for ${session.romPath}`)
			}
		}

		return orphans.length
	}

	async closeAllOpenSessions(reason: string): Promise<number> {
		const open = await this.getOpen()
		const now = new Date()

		for (const session of open) {
			const durationSec = Math.round((now.getTime() - session.startedAt.getTime()) / 1000)
			if (durationSec < MIN_DURATION_SEC) {
				await this.remove(session.id)
			} else {
				await this.close(session.id, now, durationSec, { closedReason: reason })
			}
		}

		logger.info(`Closed ${open.length} open session(s) with reason: ${reason}`)
		return open.length
	}
}
