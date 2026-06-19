import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

// libSQL driver (Turso). Async client used everywhere.
// - dev:  TURSO_DATABASE_URL unset -> local file `file:./recalbox.db`
// - prod: TURSO_DATABASE_URL=libsql://...turso.io + TURSO_AUTH_TOKEN
const url = process.env.TURSO_DATABASE_URL ?? `file:${process.env.DATABASE_PATH ?? './recalbox.db'}`
const authToken = process.env.TURSO_AUTH_TOKEN

const client = createClient({ url, authToken })
// SQLite foreign keys are off by default; match the previous better-sqlite3 setup.
client.execute('PRAGMA foreign_keys = ON').catch(() => {})

export const db = drizzle(client, { schema })
export type DB = typeof db
