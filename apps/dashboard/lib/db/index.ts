import { type Client, createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'
import { shouldUseReplica } from './should-use-replica'

// libSQL driver (Turso).
//
// - No Turso configured (pure local dev): a local SQLite file.
// - Turso + web process (SELF-HOSTED): EMBEDDED REPLICA. A local SQLite file kept in
//   sync with the Turso primary. Reads are served from the local file (instant, like
//   the old better-sqlite3 setup); writes go straight through to the primary. Without
//   this, every read is a network round-trip — read-heavy endpoints (the
//   recommender loads the whole `games` table) took ~10s.
// - Turso + web process (VERCEL): DIRECT REMOTE by default — the replica is a Fluid
//   Active CPU / cold-start re-sync footgun there. Opt in with TURSO_ENABLE_REPLICA=1.
// - Turso + scrobbler process: direct remote. It is write-heavy / read-light, so
//   it skips the replica — which also guarantees the two processes never open the
//   same replica file (embedded replicas are single-writer per file).
const remoteUrl = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
// Embedded replica (long-running web server) vs. direct-remote. The scrobbler and
// one-shot scripts always go direct (write-mostly / short-lived, avoids colliding on
// the single-writer replica file). On Vercel the replica is OFF unless explicitly
// opted in (TURSO_ENABLE_REPLICA=1) — there it burns Fluid Active CPU and re-syncs the
// whole DB on every cold start. Full policy in should-use-replica.ts.
const useReplica = shouldUseReplica()

// Reuse the client across dev hot-reloads so we don't open multiple replica sync
// loops on the same file within one process.
const g = globalThis as typeof globalThis & { __libsqlClient?: Client }

function makeClient(): Client {
	if (remoteUrl && useReplica) {
		const replicaPath = process.env.TURSO_REPLICA_PATH ?? './recalbox-replica.db'
		return createClient({
			url: `file:${replicaPath}`,
			syncUrl: remoteUrl,
			authToken,
			// Background pull of remote writes (e.g. sessions from the scrobbler).
			// 5s mirrors the existing cross-process notification poll cadence.
			syncInterval: 5,
		})
	}
	const url = remoteUrl ?? `file:${process.env.DATABASE_PATH ?? './recalbox.db'}`
	return createClient({ url, authToken })
}

const client = g.__libsqlClient ?? makeClient()
g.__libsqlClient = client

// SQLite foreign keys are off by default; match the previous better-sqlite3 setup.
client.execute('PRAGMA foreign_keys = ON').catch(() => {})

/**
 * Pull the latest snapshot from the Turso primary into the local embedded
 * replica. Await this at web startup BEFORE running migrations, otherwise drizzle
 * sees an empty local file and tries to replay every migration. No-op when not
 * using a replica (pure-local dev or the direct-remote scrobbler).
 */
export async function syncDb(): Promise<void> {
	if (!useReplica) return
	try {
		await client.sync()
	} catch (err) {
		// Non-fatal: the periodic syncInterval retries and a stale replica still reads.
		console.error('[db] embedded replica initial sync failed', err)
	}
}

export const db = drizzle(client, { schema })
export type DB = typeof db
