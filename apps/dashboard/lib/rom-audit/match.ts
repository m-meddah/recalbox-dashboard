import { canonicalTitle, parseNameTags } from './canonical'
import type { Dat, DatGame, DatRom } from './dat-parser'
import type { ManifestEntry } from './manifest'

export type MatchLevel = 'verified' | 'serial' | 'named' | 'unknown'

export type MatchedFile = ManifestEntry & {
	matchLevel: MatchLevel
	datEntryName?: string
	canonicalTitle?: string
}

export type DatEntry = { game: DatGame; rom: DatRom }

export type CanonicalGame = {
	title: string
	regions: string[]
	categories: string[]
	entries: DatEntry[]
	owned: boolean
	ownedDiscs: number[]
	missingDiscs: number[]
}

export type AuditResult = {
	system: string
	datName: string
	datVersion: string
	totalRomEntries: number
	matchedRomEntries: number
	files: MatchedFile[]
	games: CanonicalGame[]
	missingGames: CanonicalGame[]
}

export type MissingFilters = {
	regions?: string[]
	excludeCategories?: string[]
}

/** "DL-DOL-GW7P-EUR" → "GW7P". The only 4-char alphanumeric segment. */
export function serialCode(serial: string): string | undefined {
	return serial.split('-').find((part) => /^[A-Z0-9]{4}$/.test(part))
}

/** Comparable form of a file or dat name: no extension, no case, single spaces. */
export function normalizeName(name: string): string {
	return name
		.replace(/\.[a-z0-9]{1,5}$/i, '')
		.replace(/_/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase()
}

function fileBaseName(path: string): string {
	return path.split('/').pop() ?? path
}

// Hashes are indexed to buckets, not to a single entry: a re-release commonly
// ships the very same image as the original, and on the Redump PSX dat a
// quarter of the entries share their hash with an earlier one. Keeping only the
// first made every later entry unmatchable, so its canonical game was reported
// missing even when the file was on the box.
type Index = {
	byCrc: Map<string, DatEntry[]>
	bySha1: Map<string, DatEntry[]>
	byMd5: Map<string, DatEntry[]>
	bySerial: Map<string, DatEntry[]>
	byName: Map<string, DatEntry>
}

function pushEntry(map: Map<string, DatEntry[]>, key: string, entry: DatEntry): void {
	const bucket = map.get(key)
	if (bucket) bucket.push(entry)
	else map.set(key, [entry])
}

function buildIndex(dat: Dat): Index {
	const index: Index = {
		byCrc: new Map(),
		bySha1: new Map(),
		byMd5: new Map(),
		bySerial: new Map(),
		byName: new Map(),
	}
	for (const game of dat.games) {
		for (const rom of game.roms) {
			const entry: DatEntry = { game, rom }
			if (rom.crc) pushEntry(index.byCrc, rom.crc, entry)
			if (rom.sha1) pushEntry(index.bySha1, rom.sha1, entry)
			if (rom.md5) pushEntry(index.byMd5, rom.md5, entry)

			const serial = rom.serial ?? game.serial
			const code = serial ? serialCode(serial) : undefined
			if (code) pushEntry(index.bySerial, code, entry)

			for (const candidate of [rom.name, game.name]) {
				const key = normalizeName(candidate)
				if (!index.byName.has(key)) index.byName.set(key, entry)
			}
		}
	}
	return index
}

/**
 * A file resolves to every dat entry that shares its hash — one file can be the
 * legitimate copy of several catalogue entries at once. The first of the bucket
 * is the one reported by name; all of them count as owned.
 */
function matchOne(file: ManifestEntry, index: Index): { entries?: DatEntry[]; level: MatchLevel } {
	if (file.crc32) {
		const hit = index.byCrc.get(file.crc32)
		if (hit) return { entries: hit, level: 'verified' }
	}
	for (const [hash, map] of [
		[file.sha1, index.bySha1],
		// rawSha1 is the SHA1 of a CHD's decompressed stream. It only ever lines
		// up with a dat sha1 on a single-track disc, where that stream is the
		// whole image; a multi-track CD hashes per track in the dat and matches
		// nothing here. Kept because single-track discs are common — not an
		// oversight.
		[file.rawSha1, index.bySha1],
		[file.md5, index.byMd5],
	] as const) {
		if (!hash) continue
		const hit = map.get(hash)
		if (hit) return { entries: hit, level: 'verified' }
	}

	if (file.serial) {
		const bucket = index.bySerial.get(file.serial) ?? []
		if (bucket.length === 1) return { entries: bucket, level: 'serial' }
		if (bucket.length > 1) {
			// Several revisions — usually the discs of one multi-disc game — share
			// a game code. Disambiguate on the file name first.
			const wanted = normalizeName(file.innerName ?? fileBaseName(file.path))
			const exact = bucket.find((e) => normalizeName(e.game.name) === wanted)
			if (exact) return { entries: [exact], level: 'serial' }

			// The name alone didn't settle it — fall back to the disc number read
			// from the RVZ/GC-Wii disc header, when the file carries one. The
			// header field is 0-based (0 = disc 1); the DAT's "(Disc N)" name tag
			// is 1-based. This is a tie-breaker, not a replacement for the name:
			// it only decides when it narrows the bucket to exactly one entry.
			const discNumber = file.discNumber
			if (discNumber !== undefined) {
				const byDisc = bucket.filter((e) => parseNameTags(e.game.name).disc === discNumber + 1)
				if (byDisc.length === 1) return { entries: byDisc, level: 'serial' }
			}
		}
	}

	const nameKey = normalizeName(file.innerName ?? fileBaseName(file.path))
	const byName = index.byName.get(nameKey)
	if (byName) return { entries: [byName], level: 'named' }

	return { level: 'unknown' }
}

/**
 * Crosses a scan manifest with a reference DAT. Pure: no network, no database,
 * no filesystem. Counting is raw — one dat rom entry is one unit — while the
 * missing list is grouped by canonical game, which is the actionable view.
 */
export function auditSystem(system: string, manifest: ManifestEntry[], dat: Dat): AuditResult {
	const index = buildIndex(dat)
	const matchedRoms = new Set<DatRom>()
	const files: MatchedFile[] = []

	// A call audits one system: a file from any other system must never enter
	// the count or match by coincidence of hash or name, so the filter is
	// enforced here rather than left to the caller.
	for (const file of manifest.filter((f) => f.system === system)) {
		const { entries, level } = matchOne(file, index)
		for (const entry of entries ?? []) matchedRoms.add(entry.rom)
		const first = entries?.[0]
		files.push({
			...file,
			matchLevel: level,
			datEntryName: first?.game.name,
			canonicalTitle: first ? canonicalTitle(first.game.name) : undefined,
		})
	}

	const grouped = new Map<string, CanonicalGame>()
	let totalRomEntries = 0

	for (const game of dat.games) {
		const title = canonicalTitle(game.name)
		const tags = parseNameTags(game.name)
		let group = grouped.get(title)
		if (!group) {
			group = {
				title,
				regions: [],
				categories: [],
				entries: [],
				owned: false,
				ownedDiscs: [],
				missingDiscs: [],
			}
			grouped.set(title, group)
		}
		for (const region of tags.regions) {
			if (!group.regions.includes(region)) group.regions.push(region)
		}
		for (const category of tags.categories) {
			if (!group.categories.includes(category)) group.categories.push(category)
		}
		for (const rom of game.roms) {
			totalRomEntries++
			group.entries.push({ game, rom })
			const owned = matchedRoms.has(rom)
			if (owned) group.owned = true
			if (tags.disc !== undefined) {
				const bucket = owned ? group.ownedDiscs : group.missingDiscs
				if (!bucket.includes(tags.disc)) bucket.push(tags.disc)
			}
		}
	}

	const games = [...grouped.values()]
	for (const game of games) {
		game.missingDiscs = game.missingDiscs.filter((d) => !game.ownedDiscs.includes(d))
	}

	return {
		system,
		datName: dat.name,
		datVersion: dat.version,
		totalRomEntries,
		matchedRomEntries: matchedRoms.size,
		files,
		games,
		missingGames: games.filter((g) => !g.owned),
	}
}

/**
 * Restricts the displayed missing list without ever changing the metric — so a
 * game is only dropped when *every* one of its entries carries an excluded
 * category. A title's categories are the union of its variants': excluding on
 * that union hid the genuinely missing commercial release of any game that
 * happened to also have a (Proto) entry.
 */
export function filterMissingGames(
	games: CanonicalGame[],
	filters: MissingFilters,
): CanonicalGame[] {
	const excluded = filters.excludeCategories ?? []
	return games.filter((game) => {
		if (filters.regions?.length) {
			if (!game.regions.some((r) => filters.regions?.includes(r))) return false
		}
		// The union decides whether the filter is concerned at all; the per-entry
		// pass then decides, and only drops the title when no variant escapes.
		if (excluded.length && game.categories.some((c) => excluded.includes(c))) {
			const everyVariantExcluded = game.entries.every((entry) =>
				parseNameTags(entry.game.name).categories.some((c) => excluded.includes(c)),
			)
			if (everyVariantExcluded) return false
		}
		return true
	})
}
