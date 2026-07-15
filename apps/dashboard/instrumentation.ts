export async function register() {
	if (process.env.NEXT_RUNTIME !== 'nodejs') return

	const [path, migrator, dbMod, multiRecalbox, configStoreMod] = await Promise.all([
		import('node:path'),
		import('drizzle-orm/libsql/migrator'),
		import('@/lib/db/index'),
		import('@/lib/db/multi-recalbox-migration'),
		import('@/lib/config-store'),
	])

	// Everything below touches the database. If it is unreachable or blocked (e.g. a
	// Turso quota freeze), these throw — and a throwing instrumentation hook takes down
	// the ENTIRE server boot, so every cold start fails to init and nothing recovers
	// until a redeploy. Boot anyway: log loudly and let the server come up. DB-backed
	// routes will error individually until the database is back, but health/static and
	// non-DB routes keep working, and the next cold start self-heals once the DB
	// recovers — no redeploy needed.
	try {
		// Hydrate the embedded replica from the Turso primary first, so the migrator
		// sees the already-migrated schema instead of replaying it against an empty
		// local file. No-op when not using a replica.
		await dbMod.syncDb()
		// On Vercel, schema migrations run at DEPLOY time (the `build` script runs
		// `drizzle-kit migrate`) — NOT per cold start. Running migrate() on every cold
		// start re-reads the migrations journal each time and, worse, lets parallel
		// cold-starting instances race to apply the same migration. Self-hosted keeps
		// runtime migrate: a single long-lived process, the natural place for it.
		if (process.env.VERCEL !== '1') {
			await migrator.migrate(dbMod.db, {
				migrationsFolder: path.default.join(process.cwd(), 'drizzle/migrations'),
			})
		}
		await multiRecalbox.runMultiRecalboxMigrationIfNeeded()
		// Load settings + recalboxes into the configStore cache so the synchronous
		// getters work for the lifetime of this server process.
		await configStoreMod.configStore.hydrate()
	} catch (err) {
		console.error(
			'[instrumentation] DB init failed at boot (replica sync / migrations / hydrate) — ' +
				'booting anyway; DB-backed routes will error until the database recovers',
			err,
		)
	}
}
