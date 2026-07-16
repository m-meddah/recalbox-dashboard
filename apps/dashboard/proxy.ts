import { getSessionCookie } from 'better-auth/cookies'
import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { routing } from './i18n/routing'

const intlMiddleware = createMiddleware(routing)

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl

	// Pass through API routes and Next.js internals unchanged
	if (
		pathname.startsWith('/api/') ||
		pathname.startsWith('/_next/') ||
		pathname.startsWith('/favicon')
	) {
		return NextResponse.next()
	}

	// Determine locale from path or default
	const segments = pathname.split('/').filter(Boolean)
	const firstSegment = segments[0]
	const isLocalePrefixed = routing.locales.includes(
		firstSegment as (typeof routing.locales)[number],
	)

	// Static assets (manifest, icons, sw.js, *.svg, …) live at the ROOT, never under a
	// locale — page routes are always /{locale}/…. So a dotted path that is NOT
	// locale-prefixed is an asset: serve it directly. This is what closes the old hole
	// where the matcher skipped auth for ANY path containing a dot, letting e.g.
	// /en/collection/foo.bar reach a data-fetching page unauthenticated.
	if (!isLocalePrefixed && /\.[a-z0-9]+$/i.test(pathname)) {
		return NextResponse.next()
	}

	const locale = isLocalePrefixed ? firstSegment : routing.defaultLocale

	const hasSession = getSessionCookie(request) != null
	const isLoginPage = pathname === `/${locale}/login` || pathname.endsWith('/login')
	// Invited members reach the accept page without a session.
	const isAcceptInvite = pathname.endsWith('/accept-invite')
	const isPublicPage = isLoginPage || isAcceptInvite
	if (!hasSession && !isPublicPage) {
		return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
	}
	if (hasSession && isLoginPage) {
		return NextResponse.redirect(new URL(`/${locale}`, request.url))
	}

	// Apply next-intl i18n routing
	return intlMiddleware(request)
}

export const config = {
	// Run on everything except Next's static/image pipelines. Dotted paths are handled
	// inside the middleware (the asset pass-through above) so that dotted PAGE routes
	// still get the auth check — the matcher must NOT blanket-skip anything with a dot.
	matcher: ['/((?!_next/static|_next/image).*)'],
}
