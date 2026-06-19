export async function register() {
	if (process.env.NEXT_RUNTIME === 'nodejs') {
		const [path, migrator, dbMod, multiRecalbox, configStoreMod] = await Promise.all([
			import('node:path'),
			import('drizzle-orm/libsql/migrator'),
			import('@/lib/db/index'),
			import('@/lib/db/multi-recalbox-migration'),
			import('@/lib/config-store'),
		])

		await migrator.migrate(dbMod.db, {
			migrationsFolder: path.default.join(process.cwd(), 'drizzle/migrations'),
		})
		await multiRecalbox.runMultiRecalboxMigrationIfNeeded()
		// Load settings + recalboxes into the configStore cache so the synchronous
		// getters work for the lifetime of this server process.
		await configStoreMod.configStore.hydrate()
	}
}
