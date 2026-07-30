import { canViewRecalbox } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { missingFiltersFrom } from '@/lib/rom-audit/filters'
import { missingGamesOf } from '@/lib/rom-audit/read-service'
import { missingGamesToCsv } from '@/lib/rom-audit/report'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The missing list of one system, as displayed — filters included. Pure
 * serialisation of what the screen already computes; no external source is
 * queried and nothing is downloaded.
 */
export async function GET(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()

	const url = new URL(req.url)
	const recalboxId = url.searchParams.get('recalboxId')
	const system = url.searchParams.get('system')
	const format = url.searchParams.get('format') ?? 'csv'
	if (!recalboxId || !system || (format !== 'csv' && format !== 'json')) {
		return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
	}
	if (!(await canViewRecalbox(user, recalboxId)))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const result = await missingGamesOf(recalboxId, system, missingFiltersFrom(url.searchParams))
	if (result.status === 'not-audited')
		return NextResponse.json({ error: 'not_audited' }, { status: 404 })
	if (result.status !== 'ok') return NextResponse.json({ error: result.status }, { status: 409 })

	if (format === 'json') {
		return NextResponse.json({ system, games: result.games })
	}

	// The system id is a `/roms` directory name, already guarded against path
	// separators and control characters upstream — but the filename is quoted
	// anyway so a space or a comma cannot split the header.
	const filename = `rom-audit-${system.replace(/[^A-Za-z0-9._-]/g, '_')}.csv`
	return new NextResponse(missingGamesToCsv(result.games), {
		status: 200,
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
		},
	})
}
