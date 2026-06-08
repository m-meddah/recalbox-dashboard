import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getPreferences, savePreferences } from '@/lib/notifications/preferences'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	const prefs = await getPreferences()
	return NextResponse.json(prefs)
}

export async function POST(req: Request) {
	if (!(await getUser())) return unauthorized()
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}
	await savePreferences(body as Parameters<typeof savePreferences>[0])
	return NextResponse.json({ ok: true })
}
