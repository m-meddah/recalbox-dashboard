/**
 * Origins Better Auth will accept for cross-origin / CSRF checks.
 * Reads BETTER_AUTH_TRUSTED_ORIGINS (comma-separated); falls back to
 * BETTER_AUTH_URL when unset. Returns [] when neither is set (Better Auth
 * then defaults to its own baseURL).
 */
export function parseTrustedOrigins(env: NodeJS.ProcessEnv): string[] {
	const csv = env.BETTER_AUTH_TRUSTED_ORIGINS
	if (csv) {
		return csv
			.split(',')
			.map((o) => o.trim())
			.filter((o) => o.length > 0)
	}
	const base = env.BETTER_AUTH_URL
	return base ? [base] : []
}
