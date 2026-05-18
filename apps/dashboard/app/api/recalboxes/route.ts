import { configStore } from '@/lib/config-store'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const all = configStore.getRecalboxes().map((rb) => ({ ...rb, sshPassword: '***' }))
	return NextResponse.json(all)
}

const createSchema = z.object({
	name: z.string().min(1).max(64),
	host: z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/),
	sshUser: z.string().min(1).max(32),
	sshPassword: z.string().min(1).max(128),
	sshPort: z.number().int().min(1).max(65535).default(22),
	mqttPort: z.number().int().min(1).max(65535).default(1883),
	color: z.string().nullable().optional(),
	iconEmoji: z.string().nullable().optional(),
})

export async function POST(req: NextRequest) {
	let body: unknown
	try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
	const parsed = createSchema.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
	const rb = configStore.addRecalbox({ ...parsed.data, color: parsed.data.color ?? null, iconEmoji: parsed.data.iconEmoji ?? null })
	return NextResponse.json({ ...rb, sshPassword: '***' }, { status: 201 })
}
