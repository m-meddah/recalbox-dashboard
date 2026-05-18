import { getVapidPublicKey } from '@/lib/notifications/vapid'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	const publicKey = await getVapidPublicKey()
	if (!publicKey) {
		return NextResponse.json({ error: 'VAPID keys not initialized' }, { status: 503 })
	}
	return NextResponse.json({ publicKey })
}
