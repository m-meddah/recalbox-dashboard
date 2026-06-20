export async function register() {
	if (process.env.NEXT_RUNTIME === 'nodejs') {
		const [path, migrator, dbMod, multiRecalbox, configStoreMod] = await Promise.all([
			import('node:path'),
			import('drizzle-orm/libsql/migrator'),
			import('@/lib/db/index'),
			import('@/lib/db/multi-recalbox-migration'),
			import('@/lib/config-store'),
		])

		// Hydrate the embedded replica from the Turso primary first, so the migrator
		// sees the already-migrated schema instead of replaying it against an empty
		// local file. No-op when not using a replica.
		await dbMod.syncDb()
		await migrator.migrate(dbMod.db, {
			migrationsFolder: path.default.join(process.cwd(), 'drizzle/migrations'),
		})
		await multiRecalbox.runMultiRecalboxMigrationIfNeeded()
		// Load settings + recalboxes into the configStore cache so the synchronous
		// getters work for the lifetime of this server process.
		await configStoreMod.configStore.hydrate()
	}
}
