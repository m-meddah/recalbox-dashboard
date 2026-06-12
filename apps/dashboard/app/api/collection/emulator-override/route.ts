import { canControlRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { updateGameEmulatorOverride } from '@/lib/db/queries'
import { logger } from '@/lib/logger'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getEsState } from '@/lib/recalbox/es-state'
import { readGamelist } from '@/lib/recalbox/gamelist-reader'
import { GameNotFoundError, setGameEmulatorOverride } from '@/lib/recalbox/gamelist-writer'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { listSystems } from '@/lib/recalbox/systems'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Emulator/core identifiers from the Recalbox catalog (e.g. "libretro", "snes9x",
// "mednafen_supergrafx"). Reject anything else as a defensive measure.
const ID_RE = /^[a-zA-Z0-9._-]+$/

function parseId(v: unknown): string | null | undefined {
	if (v === null || v === '') return null
	if (typeof v !== 'string') return undefined
	return ID_RE.test(v) ? v : undefined
}

/**
 * POST /api/collection/emulator-override
 * Body: { romPath, system, emulator: string|null, core: string|null }
 * Writes a per-game `<emulator>`/`<core>` override into the system's
 * gamelist.xml (null/"" clears it). The caller restarts ES to apply.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
	const user = await getUser()
	if (!user) return unauthorized()

	let body: { romPath?: unknown; system?: unknown; emulator?: unknown; core?: unknown }
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
	}

	const { romPath, system } = body
	const emulator = parseId(body.emulator)
	const core = parseId(body.core)
	if (
		typeof romPath !== 'string' ||
		typeof system !== 'string' ||
		emulator === undefined ||
		core === undefined
	) {
		return NextResponse.json(
			{ error: 'Invalid romPath, system, emulator or core' },
			{ status: 400 },
		)
	}

	const recalboxId = await getActiveRecalboxId()
	if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
	if (!canControlRecalbox(user, recalboxId)) return forbidden()

	// ES owns gamelist.xml and rewrites it on exit — never edit it mid-game or our
	// change would be clobbered. The client also restarts ES right after to apply.
	const state = await getEsState(recalboxId)
	if (state?.gameRunning) {
		return NextResponse.json({ error: 'busy', gameName: state.gameName }, { status: 409 })
	}

	try {
		const ssh = getSshClient(recalboxId)
		const sys = (await listSystems(ssh)).find((s) => s.id === system)
		if (!sys) return NextResponse.json({ error: 'Unknown system' }, { status: 404 })

		const prefix = `${sys.romsBasePath}/`
		if (!romPath.startsWith(prefix)) {
			return NextResponse.json({ error: 'romPath outside system' }, { status: 400 })
		}
		const relativeRomPath = romPath.slice(prefix.length)

		const xml = await readGamelist(sys.gamelistPath, ssh)
		if (xml == null) return NextResponse.json({ error: 'gamelist not found' }, { status: 404 })

		let nextXml: string
		try {
			nextXml = setGameEmulatorOverride(xml, relativeRomPath, emulator, core)
		} catch (err) {
			if (err instanceof GameNotFoundError) {
				return NextResponse.json({ error: 'Game not in gamelist' }, { status: 404 })
			}
			throw err
		}

		// Stream over stdin (gamelists can be multi-MB — too big for a shell arg).
		await ssh.writeFile(sys.gamelistPath, nextXml, {
			backupPath: `${sys.gamelistPath}.bak-dashboard`,
		})

		await updateGameEmulatorOverride(recalboxId, romPath, emulator, core)
		logger.info(
			`emulator-override: ${system}/${relativeRomPath} -> ${emulator ?? '(reset)'}/${core ?? '(reset)'}`,
		)
		return NextResponse.json({ ok: true })
	} catch (err) {
		logger.error('emulator-override failed', err)
		return NextResponse.json({ error: 'Recalbox unreachable' }, { status: 503 })
	}
}
