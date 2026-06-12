import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import {
	RECALBOX_CONF_PATH,
	extractConfKeysBySuffix,
	setConfValues,
} from '@/lib/recalbox/recalbox-conf-editor'
import { shellQuote } from '@/lib/recalbox/shell'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ID_RE = /^[a-zA-Z0-9._-]+$/

function parseId(v: unknown): string | null | undefined {
	if (v === null || v === '') return null
	if (typeof v !== 'string') return undefined
	return ID_RE.test(v) ? v : undefined
}

async function readConf(recalboxId: string): Promise<string> {
	const ssh = getSshClient(recalboxId)
	return ssh.exec(`cat ${shellQuote(RECALBOX_CONF_PATH)} 2>/dev/null || true`, 10_000)
}

/**
 * GET /api/recalbox/system-emulator
 * Returns the per-system emulator/core overrides currently set in recalbox.conf,
 * keyed by system: `{ overrides: { snes: { emulator, core }, … } }`.
 */
export async function GET(): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!canViewRecalbox(user, recalboxId)) return forbidden()

	try {
		const conf = await readConf(recalboxId)
		const emulators = extractConfKeysBySuffix(conf, '.emulator')
		const cores = extractConfKeysBySuffix(conf, '.core')
		const overrides: Record<string, { emulator: string | null; core: string | null }> = {}
		const add = (fullKey: string, suffix: string, field: 'emulator' | 'core', value: string) => {
			const system = fullKey.slice(0, -suffix.length)
			if (system === 'global') return // global default is configured elsewhere
			overrides[system] ??= { emulator: null, core: null }
			overrides[system][field] = value
		}
		for (const [k, v] of Object.entries(emulators)) add(k, '.emulator', 'emulator', v)
		for (const [k, v] of Object.entries(cores)) add(k, '.core', 'core', v)
		return NextResponse.json({ overrides })
	} catch (err) {
		logger.warn('system-emulator GET failed', err)
		return NextResponse.json({ overrides: {} })
	}
}

/**
 * POST /api/recalbox/system-emulator  { system, emulator: string|null, core: string|null }
 * Writes `{system}.emulator` / `{system}.core` into recalbox.conf over SSH
 * (null clears them, reverting to the system default). Applies on next launch.
 */
export async function POST(req: Request): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	let body: { system?: unknown; emulator?: unknown; core?: unknown }
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
	}

	const system = parseId(body.system)
	const emulator = parseId(body.emulator)
	const core = parseId(body.core)
	if (!system || emulator === undefined || core === undefined) {
		return NextResponse.json({ error: 'Invalid system, emulator or core' }, { status: 400 })
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!canControlRecalbox(user, recalboxId)) return forbidden()

	try {
		const conf = await readConf(recalboxId)
		if (!conf.trim())
			return NextResponse.json({ error: 'recalbox.conf not found' }, { status: 404 })

		const next = setConfValues(conf, {
			[`${system}.emulator`]: emulator,
			[`${system}.core`]: core,
		})
		const ssh = getSshClient(recalboxId)
		await ssh.writeFile(RECALBOX_CONF_PATH, next, {
			backupPath: `${RECALBOX_CONF_PATH}.bak-dashboard`,
			timeoutMs: 15_000,
		})
		logger.info(`system-emulator: ${system} -> ${emulator ?? '(reset)'}/${core ?? '(reset)'}`)
		return NextResponse.json({ ok: true })
	} catch (err) {
		logger.error('system-emulator POST failed', err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}
