import type { Config } from 'drizzle-kit'

export default {
	schema: './lib/db/schema.ts',
	out: './drizzle/migrations',
	dialect: 'sqlite',
	dbCredentials: {
		url: process.env['DATABASE_PATH'] ?? './recalbox.db',
	},
} satisfies Config
