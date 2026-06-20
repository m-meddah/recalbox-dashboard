import { type Client, createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

// libSQL driver (Turso).
//
// - No Turso configured (pure local dev): a local SQLite file.
// - Turso + web process: EMBEDDED REPLICA. A local SQLite file kept in sync with
//   the Turso primary. Reads are served from the local file (instant, like the
//   old better-sqlite3 setup); writes go straight through to the primary. Without
//   this, every read is a network round-trip — read-heavy endpoints (the
//   recommender loads the whole `games` table) took ~10s.
// - Turso + scrobbler process: direct remote. It is write-heavy / read-light, so
//   it skips the replica — which also guarantees the two processes never open the
//   same replica file (embedded replicas are single-writer per file).
const remoteUrl = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
// The scrobbler runs as `tsx scripts/start-scrobbler.ts` (dev) or `node scrobbler.js`
// (prod bundle); the web server (`next dev` / `server.js`) never has "scrobbler" in argv.
const isScrobbler = process.argv.some((a) => a.includes('scrobbler'))
const useReplica = Boolean(remoteUrl) && !isScrobbler && process.env.TURSO_DISABLE_REPLICA !== '1'

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
