import { type RomFileRow, type RomSystemAuditRow, entryKey } from '@/lib/db/rom-audit-queries'
import type { AuditResult, MatchLevel } from './match'

/**
 * How much of a scan is written to the database.
 *
 * - `detail` — every scanned entry lands in `rom_files`. Self-hosted, where the
 *   database is a local SQLite file and rows are free.
 * - `aggregates` — only the per-system aggregate, plus the `unknown` entries.
 *   The cloud deploy, where a full collection would be tens of thousands of
 *   rows per scan against a metered Turso quota.
 *
 * The missing-games list stays computable in both modes: `matchedEntries` on the
 * aggregate row carries the DAT entry names the collection covers.
 */
export type PersistPolicy = 'detail' | 'aggregates'

/** Takes the flag rather than reading the environment, so both modes are testable. */
export function persistPolicyFor(serverless: boolean): PersistPolicy {
	return serverless ? 'aggregates' : 'detail'
}

function countBy(result: AuditResult, level: MatchLevel): number {
	return result.files.filter((f) => f.matchLevel === level).length
}

export function auditToSystemRow(
	recalboxId: string,
	result: AuditResult,
	mounts: readonly string[],
	scannedAt: Date,
): RomSystemAuditRow {
	const matchedEntries = [
		...new Set(result.files.map((f) => f.datEntryName).filter((name): name is string => !!name)),
	].sort()

	return {
		recalboxId,
		system: result.system,
		datName: result.datName || null,
		datVersion: result.datVersion || null,
		totalRomEntries: result.totalRomEntries,
		matchedRomEntries: result.matchedRomEntries,
		verifiedCount: countBy(result, 'verified'),
		serialCount: countBy(result, 'serial'),
		namedCount: countBy(result, 'named'),
		unknownCount: countBy(result, 'unknown'),
		filesScanned: result.files.length,
		totalBytes: result.files.reduce((sum, f) => sum + f.size, 0),
		mounts: [...mounts],
		matchedEntries,
		scannedAt,
	}
}

export function auditToFileRows(
	recalboxId: string,
	result: AuditResult,
	policy: PersistPolicy,
	scannedAt: Date,
): RomFileRow[] {
	const files =
		policy === 'detail' ? result.files : result.files.filter((f) => f.matchLevel === 'unknown')

	// Every optional column is written as an explicit null: Drizzle treats
	// `undefined` as "column absent", which on an update silently keeps the
	// previous value — a file that stopped matching would keep its old dat entry.
	return files.map((file) => ({
		recalboxId,
		entryKey: entryKey(file.path, file.innerName ?? null),
		system: file.system,
		mount: file.mount,
		path: file.path,
		innerName: file.innerName ?? null,
		size: file.size,
		mtime: file.mtime,
		kind: file.kind,
		crc32: file.crc32 ?? null,
		sha1: file.sha1 ?? null,
		serial: file.serial ?? null,
		matchLevel: file.matchLevel,
		datEntryName: file.datEntryName ?? null,
		canonicalTitle: file.canonicalTitle ?? null,
		scannedAt,
	}))
}
