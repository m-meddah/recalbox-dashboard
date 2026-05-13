import { isSetupComplete } from '@/lib/db/queries'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
	return NextResponse.json({ setupComplete: isSetupComplete() })
}
