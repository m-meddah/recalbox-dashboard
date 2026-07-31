import { describe, expect, it } from 'vitest'
import { buildSecurityHeaders } from '../headers'

function headerMap(env: Partial<NodeJS.ProcessEnv>): Record<string, string> {
	return Object.fromEntries(
		buildSecurityHeaders(env as NodeJS.ProcessEnv).map((h) => [h.key, h.value]),
	)
}

function directives(env: Partial<NodeJS.ProcessEnv>): Record<string, string> {
	const csp = headerMap(env)['Content-Security-Policy'] ?? ''
	return Object.fromEntries(
		csp.split('; ').map((d) => {
			const [name, ...sources] = d.split(' ')
			return [name ?? '', sources.join(' ')]
		}),
	)
}

const PROD = { NODE_ENV: 'production' } as const
const DEV = { NODE_ENV: 'development' } as const

describe('buildSecurityHeaders', () => {
	it('sends a CSP in every environment', () => {
		expect(headerMap(PROD)['Content-Security-Policy']).toBeTruthy()
		expect(headerMap(DEV)['Content-Security-Policy']).toBeTruthy()
	})

	it('keeps the pre-existing hardening headers', () => {
		const h = headerMap(PROD)
		expect(h['X-Content-Type-Options']).toBe('nosniff')
		expect(h['X-Frame-Options']).toBe('SAMEORIGIN')
		expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
		expect(h['Permissions-Policy']).toBe('camera=(), microphone=()')
	})

	it('locks down the directives that do not need inline escapes', () => {
		const d = directives(PROD)
		expect(d['default-src']).toBe("'self'")
		expect(d['object-src']).toBe("'none'")
		expect(d['base-uri']).toBe("'self'")
		expect(d['form-action']).toBe("'self'")
		expect(d['frame-ancestors']).toBe("'self'")
	})

	it('allows the image hosts the UI actually loads from', () => {
		const img = directives(PROD)['img-src'] ?? ''
		expect(img).toContain("'self'")
		expect(img).toContain('data:')
		// Wrapped builds its share image with URL.createObjectURL.
		expect(img).toContain('blob:')
		// RetroAchievements badges are <img> straight from their CDN.
		expect(img).toContain('https://media.retroachievements.org')
		// /api/media 302-redirects to mirrored artwork in serverless mode.
		expect(img).toContain('https://*.public.blob.vercel-storage.com')
	})

	it('does not let scripts be loaded from third-party origins', () => {
		const script = directives(PROD)['script-src'] ?? ''
		expect(script).toContain("'self'")
		expect(script).not.toContain('http')
	})

	it('keeps eval and the HMR socket out of production', () => {
		const d = directives(PROD)
		expect(d['script-src']).not.toContain("'unsafe-eval'")
		expect(d['connect-src']).toBe("'self'")
	})

	it('relaxes only what the dev server needs', () => {
		const d = directives(DEV)
		expect(d['script-src']).toContain("'unsafe-eval'")
		expect(d['connect-src']).toContain('ws:')
	})

	it('sends HSTS in production only', () => {
		expect(headerMap(PROD)['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains')
		expect(headerMap(DEV)['Strict-Transport-Security']).toBeUndefined()
	})

	it('never preloads HSTS (irreversible, and breaks plain-HTTP self-hosting)', () => {
		expect(headerMap(PROD)['Strict-Transport-Security']).not.toContain('preload')
	})
})
