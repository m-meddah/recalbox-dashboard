import { listSessions } from '@/lib/db/queries'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
	const params = req.nextUrl.searchParams

	const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10))
	const pageSize = Math.min(200, Math.max(1, Number.parseInt(params.get('pageSize') ?? '50', 10)))

	const fromParam = params.get('fromDate')
	const toParam = params.get('toDate')
	const autoClosedParam = params.get('autoClosed')

	if (fromParam && Number.isNaN(new Date(fromParam).getTime())) {
		return NextResponse.json({ error: 'Invalid fromDate' }, { status: 400 })
	}
	if (toParam && Number.isNaN(new Date(toParam).getTime())) {
		return NextResponse.json({ error: 'Invalid toDate' }, { status: 400 })
	}

	const result = await listSessions({
		system: params.get('system') ?? undefined,
		romPath: params.get('romPath') ?? undefined,
		fromDate: fromParam ? new Date(fromParam) : undefined,
		toDate: toParam ? new Date(toParam) : undefined,
		autoClosed: autoClosedParam !== null ? autoClosedParam === 'true' : undefined,
		page,
		pageSize,
	})

	return NextResponse.json({
		sessions: result.sessions,
		total: result.total,
		page,
		pageSize,
	})
}
