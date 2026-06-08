import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getQualityMetrics } from '@/lib/recommendations/quality-metrics'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
	if (!(await getUser())) return unauthorized()
	const days = Number.parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10)
	const metrics = await getQualityMetrics(Number.isFinite(days) ? days : 30)
	return NextResponse.json(metrics)
}
