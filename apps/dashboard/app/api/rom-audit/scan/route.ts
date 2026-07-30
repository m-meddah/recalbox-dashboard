import { canControlRecalbox, canViewRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { enqueueCommand } from '@/lib/db/agent-commands'
import {
	createScan,
	getLatestScan,
	isScanStale,
	listSystemAudits,
} from '@/lib/db/rom-audit-queries'
import type { RomScanRow } from '@/lib/db/rom-audit-queries'
import { logger } from '@/lib/logger'
import { startSelfHostedScan } from '@/lib/rom-audit/scan-service'
import { isServerlessMode } from '@/lib/serverless'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const StartScan = z.object({
	recalboxId: z.string().min(1),
	// A system id is a `/roms` directory name and nothing else — never a path.
	systems: z
		.array(
			z
				.string()
				.min(1)
				.max(64)
				.refine((s) => !s.includes('/') && !s.includes('\\'), 'must not contain a path separator'),
		)
		.max(256)
		.optional(),
})

/**
 * A stale scan is reported as failed without being written back: the row stays
 * as the box left it, and every reader draws the same conclusion from it.
 */
function normalize(scan: RomScanRow | null): RomScanRow | null {
	if (!scan || !isScanStale(scan)) return scan
	return { ...scan, status: 'failed', error: scan.error ?? 'interrupted' }
}

function isLive(scan: RomScanRow | null): boolean {
	return !!scan && (scan.status === 'running' || scan.status === 'pending')
}

/** Start a scan. Owner-only: it drives the box and writes the audit tables. */
export async function POST(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()

	const body = await req.json().catch(() => null)
	const parsed = StartScan.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	const { recalboxId, systems } = parsed.data

	if (!(await canControlRecalbox(user, recalboxId))) return forbidden()
	if (!configStore.getRecalbox(recalboxId))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const running = normalize(await getLatestScan(db, recalboxId))
	if (isLive(running)) {
		return NextResponse.json(
			{ error: 'scan_already_running', scanId: running?.id },
			{ status: 409 },
		)
	}

	try {
		if (isServerlessMode()) {
			// The cloud cannot list the box's disks; the agent discovers them and
			// corrects systemsTotal with its first progress report.
			const scan = await createScan(db, recalboxId, 'agent', systems?.length ?? 0, user.id)
			await enqueueCommand(db, recalboxId, 'scan', { scanId: scan.id, systems }, user.id)
			return NextResponse.json({ scanId: scan.id, transport: 'agent' }, { status: 202 })
		}

		const outcome = await startSelfHostedScan(recalboxId, user.id, systems)
		if (outcome.status === 'unreachable') {
			return NextResponse.json(
				{ error: 'box_unreachable', detail: outcome.reason },
				{ status: 502 },
			)
		}
		if (outcome.status === 'no-targets') {
			return NextResponse.json({ error: 'no_scan_target' }, { status: 422 })
		}
		return NextResponse.json(
			{ scanId: outcome.scanId, transport: 'ssh', systemsTotal: outcome.systemsTotal },
			{ status: 202 },
		)
	} catch (e) {
		logger.error('[rom-audit] failed to start scan', e)
		return NextResponse.json({ error: 'scan_start_failed' }, { status: 500 })
	}
}

/** State of the latest scan — polled by the audit page while one is in flight. */
export async function GET(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()

	const recalboxId = new URL(req.url).searchParams.get('recalboxId')
	if (!recalboxId) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	if (!(await canViewRecalbox(user, recalboxId)))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const scan = normalize(await getLatestScan(db, recalboxId))
	const systems = await listSystemAudits(db, recalboxId)
	return NextResponse.json({ scan, systems: systems.length })
}
