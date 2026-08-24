import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { HOST_REGEX } from '@/lib/validation/host'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!(await canViewRecalbox(user, id)))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })
	const rb = configStore.getRecalbox(id)
	if (!rb) return NextResponse.json({ error: 'Not found' }, { status: 404 })
	return NextResponse.json({ ...rb, sshPassword: '***' })
}

const updateSchema = z.object({
	name: z.string().min(1).max(64).optional(),
	host: z.string().min(1).regex(HOST_REGEX).optional(),
	sshUser: z.string().min(1).max(32).optional(),
	sshPassword: z.string().max(128).optional(),
	sshPort: z.number().int().min(1).max(65535).optional(),
	mqttPort: z.number().int().min(1).max(65535).optional(),
	color: z.string().nullable().optional(),
	iconEmoji: z.string().nullable().optional(),
	archived: z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!(await canControlRecalbox(user, id))) return forbidden()
	if (!configStore.getRecalbox(id))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}
	const parsed = updateSchema.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
	// "Don't touch the password" arrives in two shapes, and BOTH must survive a save that
	// only meant to rename the box: '***' is the mask GET hands back, '' is what the edit
	// page sends (it blanks the field rather than prefilling a secret it never receives).
	// Treating the blank as a value made min(1) reject every untouched save with a 422.
	const patch = { ...parsed.data }
	if (patch.sshPassword === '***' || patch.sshPassword === '') patch.sshPassword = undefined
	await configStore.updateRecalboxConfig(id, patch)
	const updated = configStore.getRecalbox(id)
	if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
	return NextResponse.json({ ...updated, sshPassword: '***' })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!(await canControlRecalbox(user, id))) return forbidden()
	if (!configStore.getRecalbox(id))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })
	const all = configStore.getRecalboxes().filter((r) => !r.archived)
	if (all.length === 1 && all[0]?.id === id) {
		return NextResponse.json({ error: 'Cannot delete the last Recalbox' }, { status: 409 })
	}
	await configStore.removeRecalbox(id)
	return NextResponse.json({ ok: true })
}
