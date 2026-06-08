import { getUser, unauthorized } from '@/lib/auth/require-user'
import { deleteVapidKeys } from '@/lib/notifications/vapid'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE() {
	if (!(await getUser())) return unauthorized()
	await deleteVapidKeys()
	return NextResponse.json({ ok: true })
}
