import { getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { getPerCoreUsage } from '@/lib/recalbox/system-stats'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<NextResponse> {
	if (!(await getUser())) return unauthorized()
	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) {
		return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	}

	const host = configStore.getRecalbox(recalboxId)?.host
	const ssh = getSshClient(recalboxId)

	const [perCore, storage] = await Promise.all([
		getPerCoreUsage(ssh).catch(() => [] as number[]),
		host ? fetchStorageInfo(host) : Promise.resolve([]),
	])

	return NextResponse.json({ perCore, storage })
}
