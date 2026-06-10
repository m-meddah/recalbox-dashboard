import type { BetterAuthOptions } from 'better-auth'

/**
 * Rate-limit config for Better Auth. Enabled only in production (the login page
 * is publicly reachable via Tailscale Funnel). A strict per-path rule throttles
 * brute-force attempts on email sign-in; other endpoints use the window default.
 * In-memory store (single instance).
 */
export function buildRateLimitConfig(env: NodeJS.ProcessEnv): BetterAuthOptions['rateLimit'] {
	return {
		enabled: env.NODE_ENV === 'production',
		window: 60,
		max: 100,
		customRules: {
			'/sign-in/email': { window: 60, max: 5 },
		},
	}
}
