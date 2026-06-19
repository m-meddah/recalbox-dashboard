import type { Config } from 'drizzle-kit'

// Env-aware: point drizzle-kit at Turso when TURSO_DATABASE_URL is set, otherwise
// the local SQLite file. The schema + migrations are identical (libSQL = SQLite).
const tursoUrl = process.env.TURSO_DATABASE_URL

export default (
	tursoUrl
		? {
				schema: './lib/db/schema.ts',
				out: './drizzle/migrations',
				dialect: 'turso',
				dbCredentials: { url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN },
			}
		: {
				schema: './lib/db/schema.ts',
				out: './drizzle/migrations',
				dialect: 'sqlite',
				dbCredentials: { url: process.env.DATABASE_PATH ?? './recalbox.db' },
			}
) satisfies Config
