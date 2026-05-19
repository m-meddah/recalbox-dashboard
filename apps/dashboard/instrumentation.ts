export async function register() {
	if (process.env.NEXT_RUNTIME === 'nodejs') {
		const path = await import('node:path')
		const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
		const { db } = await import('@/lib/db/index')
		migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle/migrations') })

		const { runMultiRecalboxMigrationIfNeeded } = await import('@/lib/db/multi-recalbox-migration')
		runMultiRecalboxMigrationIfNeeded()
	}
}
