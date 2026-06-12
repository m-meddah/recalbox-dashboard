import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { isKnownApiSection, isSecretKey } from '@/lib/recalbox/config-schema'
import {
	type ConfigValue,
	SECRET_SENTINEL,
	fetchConfigSection,
	maskSecrets,
	saveConfigSection,
} from '@/lib/recalbox/web-config'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ section: string }> }

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	const { section } = await params
	if (!isKnownApiSection(section)) {
		return NextResponse.json({ error: 'Unknown section' }, { status: 404 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!canViewRecalbox(user, recalboxId)) return forbidden()

	const host = configStore.getRecalbox(recalboxId)?.host
	if (!host) return NextResponse.json({ fields: [] })

	const fields = await fetchConfigSection(host, section)
	return NextResponse.json({ fields: maskSecrets(fields, isSecretKey) })
}

export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	const { section } = await params
	if (!isKnownApiSection(section)) {
		return NextResponse.json({ error: 'Unknown section' }, { status: 404 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!canControlRecalbox(user, recalboxId)) return forbidden()

	const host = configStore.getRecalbox(recalboxId)?.host
	if (!host) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })

	const body = (await req.json().catch(() => null)) as { changes?: unknown } | null
	const changes = sanitizeChanges(body?.changes)
	if (changes === null) {
		return NextResponse.json({ error: 'Invalid changes' }, { status: 400 })
	}
	if (Object.keys(changes).length === 0) {
		return NextResponse.json({ ok: true, applied: 0 })
	}

	try {
		await saveConfigSection(host, section, changes)
		return NextResponse.json({ ok: true, applied: Object.keys(changes).length })
	} catch (err) {
		// Never log `changes` — it may carry secrets.
		logger.error(`Config write to "${section}" failed`, err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}

/**
 * Accept only a flat map of primitive values. Drops secret keys still set to
 * the masking sentinel so an untouched password field never overwrites the
 * real value. Returns null when the payload is malformed.
 */
function sanitizeChanges(input: unknown): Record<string, ConfigValue> | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null
	const out: Record<string, ConfigValue> = {}
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
			return null
		}
		if (isSecretKey(key) && value === SECRET_SENTINEL) continue
		out[key] = value
	}
	return out
}
