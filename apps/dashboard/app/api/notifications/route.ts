import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getNotificationService } from '@/lib/notifications/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	const service = getNotificationService()
	const [items, unreadCount] = await Promise.all([service.listRecent(50), service.getUnreadCount()])
	return NextResponse.json({ notifications: items, unreadCount })
}
