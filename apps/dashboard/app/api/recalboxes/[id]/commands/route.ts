import { commandSchema, toQueuePayload } from '@/lib/agent/commands'
import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { enqueueCommand, listCommands } from '@/lib/db/agent-commands'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// List recent commands (history + status) for a Recalbox the user can see.
export async function GET(_req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!canViewRecalbox(user, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
	if (!configStore.getRecalbox(id))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const commands = await listCommands(db, id)
	return NextResponse.json({ commands })
}

// Enqueue a remote-control command. Owner-only (canControl); the command type
// and shape are validated against the server-side allowlist.
export async function POST(req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!canControlRecalbox(user, id)) return forbidden()
	if (!configStore.getRecalbox(id))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const body = await req.json().catch(() => null)
	const parsed = commandSchema.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

	const { type, payload } = toQueuePayload(parsed.data)
	const row = await enqueueCommand(db, id, type, payload, user.id)
	return NextResponse.json({ command: row }, { status: 201 })
}
