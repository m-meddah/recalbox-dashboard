import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { createAgentToken, listAgentTokens } from '@/lib/db/agent-queries'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!canViewRecalbox(user, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
	if (!configStore.getRecalbox(id))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const tokens = await listAgentTokens(db, id)
	return NextResponse.json({
		// Active tokens only, and never expose the stored hash.
		tokens: tokens
			.filter((t) => !t.revokedAt)
			.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt })),
	})
}

const createSchema = z.object({ name: z.string().trim().max(64).optional() })

export async function POST(req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!canControlRecalbox(user, id)) return forbidden()
	if (!configStore.getRecalbox(id))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const body = await req.json().catch(() => null)
	const parsed = createSchema.safeParse(body ?? {})
	if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

	const { token, row } = await createAgentToken(db, id, parsed.data.name || undefined)
	const base = (process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, '')
	// `token` is the raw value — returned once, never stored or retrievable again.
	return NextResponse.json(
		{ token, id: row.id, name: row.name, createdAt: row.createdAt, ingestUrl: `${base}/api/agent/ingest` },
		{ status: 201 },
	)
}
