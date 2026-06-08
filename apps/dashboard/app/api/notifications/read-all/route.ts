import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getNotificationService } from '@/lib/notifications/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
	if (!(await getUser())) return unauthorized()
	await getNotificationService().markAllRead()
	return NextResponse.json({ ok: true })
}
