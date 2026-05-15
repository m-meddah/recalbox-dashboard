import { listRegions } from '@/lib/db/queries'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
	const system = req.nextUrl.searchParams.get('system') ?? undefined
	const regions = await listRegions(system)
	return NextResponse.json({ regions })
}
