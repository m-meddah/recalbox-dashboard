import type { DB } from '@/lib/db'
import { nowPlaying } from '@/lib/db/schema'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'
import { eq } from 'drizzle-orm'

export type NowPlayingRow = typeof nowPlaying.$inferSelect

export type NowPlayingInput = {
	playing: boolean
	system?: string | null
	systemFullName?: string | null
	romPath?: string | null
	gameName?: string | null
	imagePath?: string | null
	emulator?: string | null
	fromScreensaver?: boolean
	startedAt?: Date | null
}

/** Upsert the single live "now playing" row for a Recalbox (pushed by the agent). */
export async function upsertNowPlaying(
	db: DB,
	recalboxId: string,
	input: NowPlayingInput,
): Promise<void> {
	const row = {
		recalboxId,
		playing: input.playing,
		system: input.system ?? null,
		systemFullName: input.systemFullName ?? null,
		romPath: input.romPath ?? null,
		gameName: input.gameName ?? null,
		imagePath: input.imagePath ?? null,
		emulator: input.emulator ?? null,
		fromScreensaver: input.fromScreensaver ?? false,
		startedAt: input.startedAt ?? null,
		updatedAt: new Date(),
	}
	await db
		.insert(nowPlaying)
		.values(row)
		.onConflictDoUpdate({ target: nowPlaying.recalboxId, set: row })
}

export async function getNowPlaying(db: DB, recalboxId: string): Promise<NowPlayingRow | undefined> {
	return db.select().from(nowPlaying).where(eq(nowPlaying.recalboxId, recalboxId)).get()
}

export async function getAllNowPlaying(db: DB): Promise<NowPlayingRow[]> {
	return db.select().from(nowPlaying).all()
}

/**
 * Reconstruct the live SSE event from a stored row, so the now-playing UI can
 * consume DB-relayed state exactly like a live MQTT event (zero UI changes).
 * Returns a game:start when playing, otherwise a game:stop for the last game.
 */
export function nowPlayingToEvent(row: NowPlayingRow): GameStartEvent | GameStopEvent {
	if (row.playing) {
		return {
			type: 'game:start',
			system: row.system ?? '',
			systemFullName: row.systemFullName ?? row.system ?? '',
			gameName: row.gameName ?? '',
			romPath: row.romPath ?? '',
			imagePath: row.imagePath ?? undefined,
			emulator: row.emulator ?? undefined,
			startedAt: row.startedAt ?? row.updatedAt,
			fromScreensaver: row.fromScreensaver,
		}
	}
	return {
		type: 'game:stop',
		system: row.system ?? '',
		gameName: row.gameName ?? '',
		romPath: row.romPath ?? '',
		stoppedAt: row.updatedAt,
	}
}
