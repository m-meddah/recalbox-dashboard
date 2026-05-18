export async function register() {
	if (process.env.NEXT_RUNTIME === 'nodejs') {
		const { runMultiRecalboxMigrationIfNeeded } = await import('@/lib/db/multi-recalbox-migration')
		runMultiRecalboxMigrationIfNeeded()
	}
}
