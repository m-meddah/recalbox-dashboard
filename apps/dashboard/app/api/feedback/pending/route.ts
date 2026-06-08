import { getUser, unauthorized } from '@/lib/auth/require-user'
import { feedbackService } from '@/lib/feedback/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
	if (!(await getUser())) return unauthorized()
	const pending = await feedbackService.getPending()
	return NextResponse.json({ pending })
}
