import { feedbackService } from '@/lib/feedback/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
	const pending = await feedbackService.getPending()
	return NextResponse.json({ pending })
}
