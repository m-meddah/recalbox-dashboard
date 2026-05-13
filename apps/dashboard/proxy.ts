import { type NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl

	// Always allow API routes, Next.js internals, and static assets
	if (
		pathname.startsWith('/api/') ||
		pathname.startsWith('/_next/') ||
		pathname.startsWith('/favicon')
	) {
		return NextResponse.next()
	}

	const setupDone = request.cookies.get('setup_done')?.value === '1'

	if (!setupDone && pathname !== '/welcome') {
		return NextResponse.redirect(new URL('/welcome', request.url))
	}

	if (setupDone && pathname === '/welcome') {
		return NextResponse.redirect(new URL('/', request.url))
	}

	return NextResponse.next()
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
