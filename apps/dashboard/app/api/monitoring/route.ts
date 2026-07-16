import { loadRecalbox } from '@/lib/auth/recalbox-acl'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { getPerCoreUsage } from '@/lib/recalbox/system-stats'
import { isServerlessMode } from '@/lib/serverless'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
	if (!(await getUser())) return unauthorized()
	// Serverless: no SSH/HTTP link to the NAT'd box — the ServerlessSystemPanel is
	// fed by the agent via SSE instead. Never attempt SSH here.
	if (isServerlessMode()) return NextResponse.json({ perCore: [], storage: [] })
	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	}

	const host = (await loadRecalbox(recalboxId))?.host
	const ssh = getSshClient(recalboxId)

	const [perCore, storage] = await Promise.all([
		getPerCoreUsage(ssh).catch(() => [] as number[]),
		host ? fetchStorageInfo(host) : Promise.resolve([]),
	])

	return NextResponse.json({ perCore, storage })
}
