import { NextResponse } from 'next/server'
import { getMatchState } from '../route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	return NextResponse.json(getMatchState())
}
