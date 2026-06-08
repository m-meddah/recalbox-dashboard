import { getUser, unauthorized } from '@/lib/auth/require-user'
import { saveAndTestCredentials } from '@/lib/igdb/auth'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Schema = z.object({
	clientId: z.string().min(10),
	clientSecret: z.string().min(10),
})

export async function POST(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
	}

	const parsed = Schema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 })
	}

	const result = await saveAndTestCredentials(parsed.data.clientId, parsed.data.clientSecret)
	if (!result.ok) {
		return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
	}
	return NextResponse.json({ ok: true })
}
