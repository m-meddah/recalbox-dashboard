import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getSessionStats } from '@/lib/db/queries'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
	const params = req.nextUrl.searchParams

	const fromParam = params.get('fromDate')
	const toParam = params.get('toDate')
	const limitParam = params.get('topGamesLimit')

	const stats = await getSessionStats({
		fromDate: fromParam ? new Date(fromParam) : undefined,
		toDate: toParam ? new Date(toParam) : undefined,
		topGamesLimit: limitParam ? Number.parseInt(limitParam, 10) : undefined,
	})

	return NextResponse.json(stats)
}
