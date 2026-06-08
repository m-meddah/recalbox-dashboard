import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getNotificationService } from '@/lib/notifications/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	if (!(await getUser())) return unauthorized()
	const { id } = await params
	const numId = Number.parseInt(id, 10)
	if (Number.isNaN(numId)) {
		return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
	}
	await getNotificationService().markRead(numId)
	return NextResponse.json({ ok: true })
}
