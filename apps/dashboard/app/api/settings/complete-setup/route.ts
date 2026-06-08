import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
	if (!(await getUser())) return unauthorized()
	configStore.markSetupComplete()

	const response = NextResponse.json({ ok: true })
	response.cookies.set('setup_done', '1', {
		httpOnly: true,
		path: '/',
		maxAge: 60 * 60 * 24 * 365,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
	})
	return response
}
