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
	const locale = routing.locales.includes(firstSegment as (typeof routing.locales)[number])
		? firstSegment
		: routing.defaultLocale

	const hasSession = getSessionCookie(request) != null
	const isLoginPage = pathname === `/${locale}/login` || pathname.endsWith('/login')
	if (!hasSession && !isLoginPage) {
		return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
	}
	if (hasSession && isLoginPage) {
		return NextResponse.redirect(new URL(`/${locale}`, request.url))
	}

	// Apply next-intl i18n routing
	return intlMiddleware(request)
}

export const config = {
	// Skip Next internals and any path that looks like a static file (contains a dot),
	// e.g. /recalbox/*.svg, /icons/*, /manifest.webmanifest — these are served directly.
	matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
}
