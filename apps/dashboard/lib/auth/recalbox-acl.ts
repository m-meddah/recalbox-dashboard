import { listRecalboxes, rowToInstance } from '@/lib/db/recalbox-queries'
import type { RecalboxInstance } from '@/lib/settings/schemas'
import { cache } from 'react'

/**
 * The registered Recalboxes, for the WEB REQUEST PATH — read from the DB, memoized
 * for the lifetime of ONE request.
 *
 * Why not `configStore`: its rows are hydrated once at process boot and afterwards
 * only kept current write-through, on whichever process handled the mutation. That
 * holds for the single long-lived self-hosted processes (scrobbler, MQTT/SSH pools),
 * which is why those keep reading the store. It does NOT hold on Vercel, where each
 * warm instance drifts from the DB indefinitely: a box added elsewhere stays
 * invisible, and — the reason this is a security fix, not just a staleness one — a
 * deleted box or a reassigned `ownerUserId` keeps passing the ownership checks on
 * every instance that never saw the mutation.
 *
 * `cache()` is REQUEST-scoped memoization, not a cache: nothing survives the
 * response, so every request re-reads and no authorization is ever served from a
 * stale snapshot. It only collapses the several checks of a single render (layout +
 * page + route ownership) into one read. Note this is deliberately NOT `'use cache'`,
 * which persists ACROSS requests per instance and would reintroduce exactly the drift
 * described above.
 *
 * Outside a request scope React invokes the function directly — no memoization and no
 * global cache — so the degraded mode is a redundant query, never a stale allow.
 *
 * Fails CLOSED: `listRecalboxes()` swallows DB errors and returns [], which denies
 * access rather than granting it.
 */
export const loadRecalboxes = cache(async (): Promise<RecalboxInstance[]> => {
	const rows = await listRecalboxes()
	return rows.map(rowToInstance)
})

/** A single Recalbox by id, sharing the same per-request read as `loadRecalboxes()`. */
export async function loadRecalbox(id: string): Promise<RecalboxInstance | null> {
	const all = await loadRecalboxes()
	return all.find((r) => r.id === id) ?? null
}
