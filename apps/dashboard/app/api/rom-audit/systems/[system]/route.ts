import { canViewRecalbox } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { missingFiltersFrom } from '@/lib/rom-audit/filters'
import type { MatchLevel } from '@/lib/rom-audit/match'
import { OWNED_LEVELS, missingGamesOf, romFilesOf } from '@/lib/rom-audit/read-service'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

type Ctx = { params: Promise<{ system: string }> }

function boundedLimit(raw: string | null): number {
	const parsed = Number.parseInt(raw ?? '', 10)
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
	return Math.min(parsed, MAX_LIMIT)
}

/**
 * Detail of one system: the missing games (the actionable list, and the default
 * tab), the owned files, or the unrecognised ones.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()

	const url = new URL(req.url)
	const recalboxId = url.searchParams.get('recalboxId')
	if (!recalboxId) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	if (!(await canViewRecalbox(user, recalboxId)))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const { system } = await params
	const tab = url.searchParams.get('tab') ?? 'missing'
	const limit = boundedLimit(url.searchParams.get('limit'))
	const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

	if (tab === 'missing') {
		const result = await missingGamesOf(recalboxId, system, missingFiltersFrom(url.searchParams))
		if (result.status === 'not-audited')
			return NextResponse.json({ error: 'not_audited' }, { status: 404 })
		if (result.status !== 'ok') return NextResponse.json({ games: [], reason: result.status })
		return NextResponse.json({
			games: result.games.slice(offset, offset + limit),
			total: result.total,
		})
	}

	if (tab !== 'owned' && tab !== 'unknown') {
		return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	}

	// "Owned" is every level but unknown — verified, serial AND named. Mapping it
	// to `verified` alone would hide every CHD (which can only ever reach `named`)
	// and every RVZ identified by serial.
	const levels: MatchLevel[] = tab === 'unknown' ? ['unknown'] : OWNED_LEVELS
	const result = await romFilesOf(recalboxId, system, levels, { limit, offset })
	if (result.status === 'not-audited')
		return NextResponse.json({ error: 'not_audited' }, { status: 404 })
	if (result.status !== 'ok') return NextResponse.json({ files: [], reason: result.status })
	return NextResponse.json({ files: result.files })
}
