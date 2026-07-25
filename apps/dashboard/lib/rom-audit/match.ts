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

type Index = {
	byCrc: Map<string, DatEntry>
	bySha1: Map<string, DatEntry>
	byMd5: Map<string, DatEntry>
	bySerial: Map<string, DatEntry[]>
	byName: Map<string, DatEntry>
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
			if (rom.crc && !index.byCrc.has(rom.crc)) index.byCrc.set(rom.crc, entry)
			if (rom.sha1 && !index.bySha1.has(rom.sha1)) index.bySha1.set(rom.sha1, entry)
			if (rom.md5 && !index.byMd5.has(rom.md5)) index.byMd5.set(rom.md5, entry)

			const serial = rom.serial ?? game.serial
			const code = serial ? serialCode(serial) : undefined
			if (code) {
				const bucket = index.bySerial.get(code)
				if (bucket) bucket.push(entry)
				else index.bySerial.set(code, [entry])
			}

			for (const candidate of [rom.name, game.name]) {
				const key = normalizeName(candidate)
				if (!index.byName.has(key)) index.byName.set(key, entry)
			}
		}
	}
	return index
}

function matchOne(file: ManifestEntry, index: Index): { entry?: DatEntry; level: MatchLevel } {
	if (file.crc32) {
		const hit = index.byCrc.get(file.crc32)
		if (hit) return { entry: hit, level: 'verified' }
	}
	for (const [hash, map] of [
		[file.sha1, index.bySha1],
		[file.rawSha1, index.bySha1],
		[file.md5, index.byMd5],
	] as const) {
		if (!hash) continue
		const hit = map.get(hash)
		if (hit) return { entry: hit, level: 'verified' }
	}

	if (file.serial) {
		const bucket = index.bySerial.get(file.serial) ?? []
		if (bucket.length === 1) return { entry: bucket[0], level: 'serial' }
		if (bucket.length > 1) {
			// Several revisions share a game code — disambiguate on the file name.
			const wanted = normalizeName(file.innerName ?? fileBaseName(file.path))
			const exact = bucket.find((e) => normalizeName(e.game.name) === wanted)
			if (exact) return { entry: exact, level: 'serial' }
		}
	}

	const nameKey = normalizeName(file.innerName ?? fileBaseName(file.path))
	const byName = index.byName.get(nameKey)
	if (byName) return { entry: byName, level: 'named' }

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

	for (const file of manifest) {
		const { entry, level } = matchOne(file, index)
		if (entry) matchedRoms.add(entry.rom)
		files.push({
			...file,
			matchLevel: level,
			datEntryName: entry?.game.name,
			canonicalTitle: entry ? canonicalTitle(entry.game.name) : undefined,
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

export function filterMissingGames(
	games: CanonicalGame[],
	filters: MissingFilters,
): CanonicalGame[] {
	return games.filter((game) => {
		if (filters.regions?.length) {
			if (!game.regions.some((r) => filters.regions?.includes(r))) return false
		}
		if (filters.excludeCategories?.length) {
			if (game.categories.some((c) => filters.excludeCategories?.includes(c))) return false
		}
		return true
	})
}
