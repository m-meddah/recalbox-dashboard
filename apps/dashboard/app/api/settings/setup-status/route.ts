import { getUser, unauthorized } from '@/lib/auth/require-user'
import { isSetupComplete } from '@/lib/db/queries'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	return NextResponse.json({ setupComplete: isSetupComplete() })
}
