import { db } from '@/lib/db/index'
import { pushSubscriptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const schema = z.object({ endpoint: z.string().url() })

export async function POST(req: Request) {
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}

	const parsed = schema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	}

	db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint)).run()
	return NextResponse.json({ ok: true })
}
