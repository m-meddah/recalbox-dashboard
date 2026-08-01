import type { BetterAuthOptions } from 'better-auth'

/**
 * Rate-limit config for Better Auth. Enabled only in production (the login page
 * is publicly reachable via Tailscale Funnel). A strict per-path rule throttles
 * brute-force attempts on email sign-in; other endpoints use the window default.
 *
 * Counters live in the DATABASE (the `rate_limit` table, see auth-schema.ts), not
 * in memory. Better Auth's default memory store counts per PROCESS: on Vercel every
 * warm instance keeps its own tally, so 5 attempts/minute really means 5 × (live
 * instances) and an attacker just spreads the guesses. A shared store is what makes
 * the ceiling real. It costs one small read+write per rate-limited auth request;
 * server components call getSession() in-process (no HTTP), so this only touches
 * genuine /api/auth/* traffic.
 */
export function buildRateLimitConfig(env: NodeJS.ProcessEnv): BetterAuthOptions['rateLimit'] {
	return {
		enabled: env.NODE_ENV === 'production',
		storage: 'database',
		window: 60,
		max: 100,
		customRules: {
			'/sign-in/email': { window: 60, max: 5 },
		},
	}
}
