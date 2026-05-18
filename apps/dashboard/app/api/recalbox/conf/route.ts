import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { isAllowedConfKey, readRecalboxConfValue } from '@/lib/recalbox/conf-reader'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url)
	const key = searchParams.get('key')

	if (!key) {
		return NextResponse.json({ error: 'Missing key query parameter' }, { status: 400 })
	}

	if (!isAllowedConfKey(key)) {
		return NextResponse.json({ error: 'Key not allowed' }, { status: 403 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	}

	const ssh = getSshClient(recalboxId)
	const value = await readRecalboxConfValue(key, ssh)

	return NextResponse.json(
		{ key, value },
		{ headers: { 'Cache-Control': 'private, max-age=60' } },
	)
}
