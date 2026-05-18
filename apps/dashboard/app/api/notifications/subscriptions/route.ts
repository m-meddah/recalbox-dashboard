import { db } from '@/lib/db/index'
import { pushSubscriptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const subs = db.select().from(pushSubscriptions).all()
	return NextResponse.json(subs)
}

export async function DELETE(req: Request) {
	const { searchParams } = new URL(req.url)
	const endpoint = searchParams.get('endpoint')
	if (!endpoint) {
		return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
	}
	db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run()
	return NextResponse.json({ ok: true })
}
