import type { DB } from '@/lib/db'
import { AGENT_LIVENESS_MS, getAgentLastSeen } from '@/lib/db/agent-liveness'
import { getNowPlaying, nowPlayingToEvent } from '@/lib/db/now-playing'
import type { SeedState } from '@/lib/sse/seed-state'

/**
 * Server-side snapshot of the live state, for serverless mode where no SSE stream
 * exists. One read of `now_playing` plus one of the agent-token liveness, per page
 * render — instead of a stream polling both every few seconds for the tab's lifetime.
 *
 * SERVER ONLY: pulls in `@/lib/db`. Never import this from a client component; the
 * client-safe half lives in `@/lib/sse/seed-state`.
 *
 * Callers MUST have checked that `recalboxId` is viewable by the current user.
 */
export async function buildSeedState(db: DB, recalboxId: string | null): Promise<SeedState> {
	const empty: SeedState = { box: null, game: null, online: false, lastSeenAt: null }
	if (!recalboxId) return empty

	const [row, lastSeen] = await Promise.all([getNowPlaying(db, recalboxId), getAgentLastSeen(db)])

	// nowPlayingToEvent returns a game:stop for a finished game — that is "nothing
	// running", not something to display.
	const event = row ? nowPlayingToEvent(row) : null
	const game = event?.type === 'game:start' ? event : null

	const seenAt = lastSeen.get(recalboxId) ?? null

	return {
		box: recalboxId,
		game,
		online: seenAt ? Date.now() - seenAt.getTime() < AGENT_LIVENESS_MS : false,
		lastSeenAt: seenAt,
	}
}
