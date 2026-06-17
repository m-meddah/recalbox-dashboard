import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import {
	RECALBOX_CONF_PATH,
	parseConfValues,
	setConfValues,
} from '@/lib/recalbox/recalbox-conf-editor'
import { shellQuote } from '@/lib/recalbox/shell'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REGION_KEY = 'emulationstation.rompreferredregion'
const FALLBACK_KEY = 'emulationstation.rompreferredfallback'
const ONE_GAME_KEY = 'emulationstation.onegameonerom'
const LATEST_KEY = 'emulationstation.showonlylatestversion'

const REGION_RE = /^[a-z]{2,8}$/
// Fallback is a single-line ordered preference, e.g. "Europe > Japan > World > USA".
const FALLBACK_RE = /^[\w >/-]{0,200}$/

export type RegionPrefs = {
	region: string | null
	fallback: string | null
	oneGameOneRom: boolean
	showOnlyLatest: boolean
}

async function readConf(recalboxId: string): Promise<string> {
	const ssh = getSshClient(recalboxId)
	return ssh.exec(`cat ${shellQuote(RECALBOX_CONF_PATH)} 2>/dev/null || true`, 10_000)
}

/**
 * GET /api/recalbox/region-prefs
 * Returns the ROM region / collection-curation preferences from recalbox.conf.
 */
export async function GET(): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!canViewRecalbox(user, recalboxId)) return forbidden()

	try {
		const conf = await readConf(recalboxId)
		const values = parseConfValues(conf, [REGION_KEY, FALLBACK_KEY, ONE_GAME_KEY, LATEST_KEY])
		const prefs: RegionPrefs = {
			region: values[REGION_KEY] ?? null,
			fallback: values[FALLBACK_KEY] ?? null,
			oneGameOneRom: values[ONE_GAME_KEY] === '1',
			showOnlyLatest: values[LATEST_KEY] === '1',
		}
		return NextResponse.json({ prefs })
	} catch (err) {
		logger.error('region-prefs GET failed', err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}

/**
 * POST /api/recalbox/region-prefs
 * Body: { region: string|null, fallback: string|null, oneGameOneRom: boolean, showOnlyLatest: boolean }
 * Writes the four emulationstation.* keys into recalbox.conf over SSH (null clears a key,
 * reverting to the Recalbox default). Takes effect on the next EmulationStation restart.
 */
export async function POST(req: Request): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	let body: {
		region?: unknown
		fallback?: unknown
		oneGameOneRom?: unknown
		showOnlyLatest?: unknown
	}
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
	}

	const region = parseOptionalString(body.region, REGION_RE)
	const fallback = parseOptionalString(body.fallback, FALLBACK_RE)
	if (region === undefined || fallback === undefined) {
		return NextResponse.json({ error: 'Invalid region or fallback' }, { status: 400 })
	}
	if (typeof body.oneGameOneRom !== 'boolean' || typeof body.showOnlyLatest !== 'boolean') {
		return NextResponse.json({ error: 'Invalid boolean flags' }, { status: 400 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!canControlRecalbox(user, recalboxId)) return forbidden()

	try {
		const conf = await readConf(recalboxId)
		if (!conf.trim())
			return NextResponse.json({ error: 'recalbox.conf not found' }, { status: 404 })

		const next = setConfValues(conf, {
			[REGION_KEY]: region,
			[FALLBACK_KEY]: fallback,
			[ONE_GAME_KEY]: body.oneGameOneRom ? '1' : '0',
			[LATEST_KEY]: body.showOnlyLatest ? '1' : '0',
		})
		const ssh = getSshClient(recalboxId)
		await ssh.writeFile(RECALBOX_CONF_PATH, next, {
			backupPath: `${RECALBOX_CONF_PATH}.bak-dashboard`,
			timeoutMs: 15_000,
		})
		logger.info(`region-prefs: region=${region ?? '(reset)'}`)
		return NextResponse.json({ ok: true })
	} catch (err) {
		logger.error('region-prefs POST failed', err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}

/**
 * Parse an optional, validated string field: empty/null → null (clears the key),
 * a string matching `re` → trimmed string, anything else → undefined (invalid).
 */
function parseOptionalString(v: unknown, re: RegExp): string | null | undefined {
	if (v === null || v === '') return null
	if (typeof v !== 'string') return undefined
	const trimmed = v.trim()
	if (trimmed === '') return null
	return re.test(trimmed) ? trimmed : undefined
}
