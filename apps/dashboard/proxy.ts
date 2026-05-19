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

	// Setup wizard redirect using the setup_done cookie
	const setupDone = request.cookies.get('setup_done')?.value === '1'
	if (!setupDone) {
		const isWelcomePage = pathname === `/${locale}/welcome` || pathname.endsWith('/welcome')
		if (!isWelcomePage) {
			return NextResponse.redirect(new URL(`/${locale}/welcome`, request.url))
		}
	} else if (pathname.endsWith('/welcome')) {
		// Redirect away from welcome if already set up
		return NextResponse.redirect(new URL(`/${locale}`, request.url))
	}

	// Apply next-intl i18n routing
	return intlMiddleware(request)
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
