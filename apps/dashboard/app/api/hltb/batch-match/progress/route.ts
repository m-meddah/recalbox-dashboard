import { getUser, unauthorized } from '@/lib/auth/require-user'
import { NextResponse } from 'next/server'
import { getMatchState } from '../route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	return NextResponse.json(getMatchState())
}
