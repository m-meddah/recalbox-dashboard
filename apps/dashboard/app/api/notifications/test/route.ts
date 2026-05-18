import { getNotificationService } from '@/lib/notifications/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
	const notif = await getNotificationService().create({
		type: 'system.alert',
		data: { message: 'Ceci est une notification test de Recalbox Dashboard.' },
	})
	return NextResponse.json({ ok: true, notification: notif })
}
