import { configStore } from '@/lib/config-store'
import { testConnection } from '@/lib/retroachievements/service'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
	const cfg = configStore.get().retroachievements
	if (!cfg.username || !cfg.apiKey) {
		return NextResponse.json(
			{ ok: false, error: 'Username and API key are required' },
			{ status: 400 },
		)
	}
	const result = await testConnection()
	return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
