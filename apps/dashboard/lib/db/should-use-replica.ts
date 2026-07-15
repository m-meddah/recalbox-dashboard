/**
 * Decide whether the libSQL **embedded replica** (a local SQLite file kept in sync
 * with the Turso primary) should be used, given the process env + argv.
 *
 * The replica is a big win on a long-running self-hosted server (instant local
 * reads) but a **footgun on Vercel**: `/tmp` is wiped between cold starts, so every
 * cold start re-syncs the entire DB from the primary, its `syncInterval` loop keeps
 * every warm instance doing work, and — because reads hit a local file synchronously
 * — they count as **Fluid Active CPU**. That combination froze the Turso sync quota
 * and burned Active CPU once already (see docs/serverless-deploy.md).
 *
 * So the policy is: **opt-OUT** everywhere (replica on by default) **except on
 * Vercel, where it is opt-IN** — a missing or fat-fingered env var can never again
 * silently run the replica in production.
 */
export function shouldUseReplica(
	env: Record<string, string | undefined> = process.env,
	argv: readonly string[] = process.argv,
): boolean {
	// No Turso configured → a pure-local SQLite file, not a replica.
	if (!env.TURSO_DATABASE_URL) return false

	// The scrobbler and one-shot scripts are write-mostly / short-lived: they use the
	// direct-remote client. This also guarantees two processes never open the same
	// replica file (embedded replicas are single-writer per file).
	if (argv.some((a) => a.includes('scrobbler'))) return false
	if (argv.some((a) => /(^|[\\/])scripts[\\/]/.test(a))) return false

	// On Vercel: opt-IN only. Anywhere else (self-hosted / local dev): opt-OUT.
	if (env.VERCEL === '1') return env.TURSO_ENABLE_REPLICA === '1'
	return env.TURSO_DISABLE_REPLICA !== '1'
}
