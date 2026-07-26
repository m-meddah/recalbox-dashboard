import { db } from '@/lib/db'
import { getSystemAudit, listRomFiles, listSystemAudits } from '@/lib/db/rom-audit-queries'
import type { RomFileRow } from '@/lib/db/rom-audit-queries'
import { isServerlessMode } from '@/lib/serverless'
import { loadDatForSystem } from './catalog'
import type { CanonicalGame, MatchLevel, MissingFilters } from './match'
import { type SystemOverview, missingGamesFor, toOverview } from './report'

export async function systemOverviews(recalboxId: string): Promise<SystemOverview[]> {
	const rows = await listSystemAudits(db, recalboxId)
	return rows.map(toOverview)
}

export type MissingResult =
	| { status: 'ok'; games: CanonicalGame[]; total: number }
	| { status: 'not-audited' }
	| { status: 'no-catalog' }
	| { status: 'catalog-unavailable' }

export async function missingGamesOf(
	recalboxId: string,
	system: string,
	filters?: MissingFilters,
): Promise<MissingResult> {
	const row = await getSystemAudit(db, recalboxId, system)
	if (!row) return { status: 'not-audited' }

	const catalog = await loadDatForSystem(system)
	if (catalog.status === 'no-catalog') return { status: 'no-catalog' }
	if (catalog.status === 'unavailable') return { status: 'catalog-unavailable' }

	const games = missingGamesFor(catalog.dat, row.matchedEntries ?? [], filters)
	return { status: 'ok', games, total: games.length }
}

export type FilesResult =
	| { status: 'ok'; files: RomFileRow[] }
	| { status: 'not-audited' }
	/** The cloud stores aggregates only — saying so beats an unexplained empty list. */
	| { status: 'aggregates-only' }

/** Owned spans every level but `unknown` — one matched rom is one owned file. */
export const OWNED_LEVELS: MatchLevel[] = ['verified', 'serial', 'named']

export async function romFilesOf(
	recalboxId: string,
	system: string,
	matchLevel: MatchLevel | readonly MatchLevel[],
	opts: { limit: number; offset: number },
): Promise<FilesResult> {
	const row = await getSystemAudit(db, recalboxId, system)
	if (!row) return { status: 'not-audited' }

	const wantsOnlyUnknown =
		matchLevel === 'unknown' ||
		(Array.isArray(matchLevel) && matchLevel.length === 1 && matchLevel[0] === 'unknown')
	// The cloud stores the unknown entries alone; asking it for owned files is a
	// question it cannot answer, and an empty list would read as "none owned".
	if (isServerlessMode() && !wantsOnlyUnknown) return { status: 'aggregates-only' }

	const files = await listRomFiles(db, recalboxId, system, { matchLevel, ...opts })
	return { status: 'ok', files }
}
