import { isAllowedConfKey, readRecalboxConfValue } from '@/lib/recalbox/conf-reader'
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

	const value = await readRecalboxConfValue(key)

	return NextResponse.json(
		{ key, value },
		{ headers: { 'Cache-Control': 'private, max-age=60' } },
	)
}
