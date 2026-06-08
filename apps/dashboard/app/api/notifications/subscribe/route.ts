import { getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db/index'
import { pushSubscriptions } from '@/lib/db/schema'
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const subscriptionSchema = z.object({
	endpoint: z.url(),
	keys: z.object({
		p256dh: z.string().min(1),
		auth: z.string().min(1),
	}),
})

export async function POST(req: Request) {
	if (!(await getUser())) return unauthorized()
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
	}

	const parsed = subscriptionSchema.safeParse(body)
	if (!parsed.success) {
		return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
	}

	const { endpoint, keys } = parsed.data
	const userAgent = req.headers.get('user-agent') ?? undefined
	const now = new Date()

	db.insert(pushSubscriptions)
		.values({
			endpoint,
			p256dh: keys.p256dh,
			auth: keys.auth,
			userAgent,
			createdAt: now,
			lastUsedAt: now,
		})
		.onConflictDoUpdate({
			target: pushSubscriptions.endpoint,
			set: { p256dh: keys.p256dh, auth: keys.auth, lastUsedAt: now },
		})
		.run()

	return NextResponse.json({ ok: true })
}
