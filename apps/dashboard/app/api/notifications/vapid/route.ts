import { deleteVapidKeys } from '@/lib/notifications/vapid'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE() {
	await deleteVapidKeys()
	return NextResponse.json({ ok: true })
}
