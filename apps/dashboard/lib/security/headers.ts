/**
 * Security response headers, applied to every route from next.config.ts.
 *
 * Kept here (rather than inline in the config) so the policy is unit-testable and
 * the reasoning for each source lives next to it — a CSP that nobody can verify
 * tends to drift into either uselessness or breakage.
 */

export type SecurityHeader = { key: string; value: string }

/** Hosts the browser is allowed to load images from, beyond our own origin. */
const IMAGE_HOSTS = [
	// Achievement badges and user avatars are rendered straight from RA's CDN
	// (see app/[locale]/achievements/page.tsx and lib/retroachievements/service.ts).
	'https://media.retroachievements.org',
	// Serverless mode: /api/media answers 302 → the mirrored artwork on Vercel Blob,
	// and the browser follows the redirect, so the final host must be allowed too.
	'https://*.public.blob.vercel-storage.com',
]

function contentSecurityPolicy(isProd: boolean): string {
	const directives: Record<string, string[]> = {
		'default-src': ["'self'"],
		// 'unsafe-inline' is still required: Next's hydration bootstrap and the
		// next-themes anti-FOUC script are inline. Removing it means switching to
		// per-request nonces from proxy.ts, which forces every prerendered page to
		// render dynamically — a separate change. Even so, 'self' already blocks the
		// main payload delivery route, loading attacker-hosted script files.
		'script-src': ["'self'", "'unsafe-inline'"],
		// Tailwind and inline style attributes (charts, animations) need this; there is
		// no meaningful stricter option short of removing all inline styles.
		'style-src': ["'self'", "'unsafe-inline'"],
		// data: for inlined icons, blob: for the Wrapped share image built client-side
		// via URL.createObjectURL (components/wrapped/share-dialog.tsx).
		'img-src': ["'self'", 'data:', 'blob:', ...IMAGE_HOSTS],
		'font-src': ["'self'", 'data:'],
		// Everything the browser talks to is same-origin: the API routes and the
		// /api/events SSE stream. Third-party APIs (IGDB, RA, HLTB, Super Retrogamers)
		// are called server-side, never from the page.
		'connect-src': ["'self'"],
		'worker-src': ["'self'", 'blob:'],
		'manifest-src': ["'self'"],
		'object-src': ["'none'"],
		'base-uri': ["'self'"],
		'form-action': ["'self'"],
		// Mirrors the X-Frame-Options: SAMEORIGIN below, for browsers that honour CSP
		// over the legacy header.
		'frame-ancestors': ["'self'"],
	}

	if (!isProd) {
		// Turbopack's dev runtime evaluates generated code and talks to its HMR socket.
		// Without these the dev server renders a blank page.
		directives['script-src']?.push("'unsafe-eval'")
		directives['connect-src']?.push('ws:', 'wss:')
	}

	return Object.entries(directives)
		.map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
		.join('; ')
}

export function buildSecurityHeaders(env: NodeJS.ProcessEnv): SecurityHeader[] {
	const isProd = env.NODE_ENV === 'production'

	const headers: SecurityHeader[] = [
		{ key: 'Content-Security-Policy', value: contentSecurityPolicy(isProd) },
		{ key: 'X-Content-Type-Options', value: 'nosniff' },
		{ key: 'X-Frame-Options', value: 'SAMEORIGIN' },
		{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
		{ key: 'Permissions-Policy', value: 'camera=(), microphone=()' },
	]

	if (isProd) {
		// Two years, subdomains included. Deliberately NOT `preload`: submission to the
		// browser preload list is effectively irreversible and would also force HTTPS on
		// self-hosted LAN/tailnet deployments that legitimately serve plain HTTP.
		// Browsers ignore this header entirely over HTTP, so it is inert there.
		headers.push({
			key: 'Strict-Transport-Security',
			value: 'max-age=63072000; includeSubDomains',
		})
	}

	return headers
}
