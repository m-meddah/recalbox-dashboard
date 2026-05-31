export async function register() {
	if (process.env.NEXT_RUNTIME === 'nodejs') {
		const [path, migrator, db, multiRecalbox] = await Promise.all([
			import('node:path'),
			import('drizzle-orm/better-sqlite3/migrator'),
			import('@/lib/db/index'),
			import('@/lib/db/multi-recalbox-migration'),
		])

		migrator.migrate(db.db, {
			migrationsFolder: path.default.join(process.cwd(), 'drizzle/migrations'),
		})
		multiRecalbox.runMultiRecalboxMigrationIfNeeded()
	}
}
