import type { RomSystemAuditRow } from '@/lib/db/rom-audit-queries'
import type { Dat } from './dat-parser'
import {
	type CanonicalGame,
	type MissingFilters,
	filterMissingGames,
	groupCanonicalGames,
} from './match'

export type SystemOverview = {
	system: string
	datName: string | null
	datVersion: string | null
	/** Null when the system has no reference catalogue: "inventory only", not 0 %. */
	percent: number | null
	totalRomEntries: number
	matchedRomEntries: number
	verified: number
	serial: number
	named: number
	unknown: number
	filesScanned: number
	totalBytes: number
	mounts: string[]
	scannedAt: string
}

export function toOverview(row: RomSystemAuditRow): SystemOverview {
	return {
		system: row.system,
		datName: row.datName,
		datVersion: row.datVersion,
		// A system with no catalogue has no completion rate. Reporting 0 % would
		// read as an empty collection, which is a different — and wrong — claim.
		percent: row.totalRomEntries > 0 ? (row.matchedRomEntries / row.totalRomEntries) * 100 : null,
		totalRomEntries: row.totalRomEntries,
		matchedRomEntries: row.matchedRomEntries,
		verified: row.verifiedCount,
		serial: row.serialCount,
		named: row.namedCount,
		unknown: row.unknownCount,
		filesScanned: row.filesScanned,
		totalBytes: row.totalBytes,
		mounts: row.mounts ?? [],
		scannedAt: row.scannedAt.toISOString(),
	}
}

/**
 * The games the collection does not cover, rebuilt from the cached DAT and the
 * stored list of matched entry names.
 *
 * Nothing about the missing list is persisted: the grouping is deterministic and
 * cheap, so recomputing it here avoids having to invalidate a cache whenever the
 * DAT is refreshed or the tag rules change.
 */
export function missingGamesFor(
	dat: Dat,
	matchedEntryNames: readonly string[],
	filters?: MissingFilters,
): CanonicalGame[] {
	const matched = new Set(matchedEntryNames)
	const games = groupCanonicalGames(dat, (_rom, game) => matched.has(game.name))
	const missing = games.filter((game) => !game.owned)
	return filters ? filterMissingGames(missing, filters) : missing
}

const CSV_COLUMNS = [
	'title',
	'region',
	'datEntry',
	'size',
	'crc32',
	'md5',
	'sha1',
	'serial',
] as const

/**
 * A value starting with `=`, `+`, `-` or `@` is executed as a formula by Excel
 * and LibreOffice. Game names beginning with `-` are real (`-Dash-`), so the
 * cell is prefixed rather than rewritten.
 */
function csvCell(value: string | number | undefined): string {
	const raw = value === undefined ? '' : String(value)
	const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
	return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** One line per DAT entry of every missing game — the shape the spec asks for. */
export function missingGamesToCsv(games: readonly CanonicalGame[]): string {
	const lines = [CSV_COLUMNS.join(',')]
	for (const game of games) {
		for (const { game: datGame, rom } of game.entries) {
			lines.push(
				[
					csvCell(game.title),
					csvCell(datGame.region ?? game.regions.join(' ')),
					// The ROM's own name, not the game's: that is the file to look for.
					csvCell(rom.name),
					csvCell(rom.size),
					csvCell(rom.crc),
					csvCell(rom.md5),
					csvCell(rom.sha1),
					csvCell(rom.serial ?? datGame.serial),
				].join(','),
			)
		}
	}
	return `${lines.join('\n')}\n`
}
