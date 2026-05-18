import { getNotificationService } from '@/lib/notifications/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const service = getNotificationService()
	const items = await service.listRecent(50)
	const unreadCount = await service.getUnreadCount()
	return NextResponse.json({ notifications: items, unreadCount })
}
