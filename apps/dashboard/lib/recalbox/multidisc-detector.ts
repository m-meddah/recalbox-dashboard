import { dirname, basename as pathBasename } from 'node:path'
import { db } from '@/lib/db/index'
import { games } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { m3uNeedsRepair, sanitizeM3uFileName } from './m3u-generator'
import { chunkShellCommands, shellQuote } from './shell'
import type { SshClientLike } from './ssh-client'

export type DiscEntry = {
	fileName: string
	discNumber: number
}

export type MultiDiscGame = {
	system: string
	baseName: string
	m3uFileName: string
	romsDir: string
	discs: DiscEntry[]
	m3uAlreadyExists: boolean
	/** Existing .m3u is present but has CRLF endings, a BOM or stray whitespace. */
	m3uNeedsRepair: boolean
	hasGap: boolean
}

export const MULTIDISC_SYSTEMS = new Set([
	'psx',
	'saturn',
	'segacd',
	'pcenginecd',
	'3do',
	'dreamcast',
	'amigacd32',
	'amigacdtv',
	'neogeocd',
	'pcfx',
	'cdi',
	'naomigd',
	// Dolphin (gamecube/wii) reads m3u too, but rejects CRLF endings and a UTF-8 BOM:
	// https://wiki.recalbox.com/fr/tutorials/games/generalities/multidisc-management-with-m3u
	// generateM3uContent emits plain LF with no BOM, so this is safe.
	'gamecube',
	'wii',
])

/**
 * Systems whose emulator rejects a malformed .m3u instead of tolerating it.
 * Dolphin fails outright on CRLF endings or a UTF-8 BOM, so for these we check
 * the formatting of files that already exist rather than just their presence.
 */
export const STRICT_M3U_SYSTEMS = new Set(['gamecube', 'wii'])

// Trailing No-Intro language tag, e.g. "(En,Fr,De,Es,It)" or "(Fr,Nl)". Region
// tags ("(Europe)", "(USA)", "(France)") are longer than two letters and never match.
const LANGUAGE_TAG = /\s*\([A-Z][a-z](?:,[A-Z][a-z])*\)$/

/**
 * Discs of one game do not always carry the same language tag — a bonus disc in
 * another language drops it. Grouping on the stripped name keeps them together.
 */
export function stripLanguageTag(baseName: string): string {
	return baseName.replace(LANGUAGE_TAG, '')
}

// Applied in order; baseName = filename portion BEFORE the match (trimEnd).
const DISC_PATTERNS: RegExp[] = [
	/\(\s*(?:disc|disk|cd)\s*[-_ ]*(\d+)(?:\s+of\s+\d+)?\s*\)/i,
	/\[\s*(?:disc|disk|cd)\s*[-_ ]*(\d+)(?:\s+of\s+\d+)?\s*\]/i,
	/(?:^|[\s\-_])(?:disc|disk|cd)\s*[-_ ]*(\d+)(?=$|[\s\-_])/i,
	/(?:^|[\s\-_])cd(\d+)(?=$|[\s\-_])/i,
]

export function detectDiscInfo(filename: string): { baseName: string; discNumber: number } | null {
	const stem = filename.replace(/\.[^.]+$/, '')

	for (const pattern of DISC_PATTERNS) {
		const match = pattern.exec(stem)
		if (!match) continue

		const discNumber = Number.parseInt(match[1] ?? '', 10)
		if (discNumber < 1 || discNumber > 10) return null

		const baseName = stem.slice(0, match.index).trimEnd()
		if (!baseName) return null

		return { baseName, discNumber }
	}
	return null
}

export async function detectMultiDiscGames(
	ssh: SshClientLike,
	recalboxId: string,
	system?: string,
): Promise<MultiDiscGame[]> {
	const { candidates } = await scanM3u(ssh, recalboxId, system)
	return candidates
}

/** An .m3u present on disk whose bytes Dolphin would reject. */
export type MalformedM3u = {
	system: string
	romsDir: string
	m3uFileName: string
}

export type M3uScan = {
	candidates: MultiDiscGame[]
	/**
	 * Malformed .m3u files with no matching disc group — the common case on
	 * GameCube, where EmulationStation hides the individual discs once an .m3u
	 * exists, so the gamelist no longer contains them to group.
	 */
	malformed: MalformedM3u[]
}

export async function scanM3u(
	ssh: SshClientLike,
	recalboxId: string,
	system?: string,
): Promise<M3uScan> {
	const empty: M3uScan = { candidates: [], malformed: [] }

	const systemFilter = system
		? MULTIDISC_SYSTEMS.has(system)
			? [system]
			: []
		: [...MULTIDISC_SYSTEMS]

	if (systemFilter.length === 0) return empty

	const systemSet = new Set(systemFilter)

	const rows = await db
		.select({ system: games.system, romPath: games.romPath })
		.from(games)
		.where(and(inArray(games.system, systemFilter), eq(games.recalboxId, recalboxId)))
		.all()

	type Group = {
		system: string
		dir: string
		/** Language-tag-stripped name; the grouping key and the fallback display name. */
		strippedName: string
		/** Every distinct baseName seen across this group's discs. */
		baseNames: Set<string>
		discs: DiscEntry[]
	}
	const groups = new Map<string, Group>()
	/** Directories of strict systems, mapped to the system that owns them. */
	const strictDirs = new Map<string, string>()

	for (const row of rows) {
		if (!systemSet.has(row.system)) continue
		if (!row.romPath) continue
		const fileName = pathBasename(row.romPath)
		const dir = dirname(row.romPath)

		if (STRICT_M3U_SYSTEMS.has(row.system)) strictDirs.set(dir, row.system)

		const info = detectDiscInfo(fileName)
		if (!info) continue

		const strippedName = stripLanguageTag(info.baseName)
		const key = `${row.system}\0${dir}\0${strippedName}`
		let group = groups.get(key)
		if (!group) {
			group = { system: row.system, dir, strippedName, baseNames: new Set(), discs: [] }
			groups.set(key, group)
		}
		group.baseNames.add(info.baseName)
		group.discs.push({ fileName, discNumber: info.discNumber })
	}

	const candidates = [...groups.values()].flatMap((g) => {
		if (g.discs.length < 2) return []
		// All discs agree on a name → use it verbatim. They disagree only when a
		// language tag is present on some discs and not others, so fall back to
		// the common denominator rather than picking one disc's spelling.
		const [only] = [...g.baseNames]
		return [{ ...g, baseName: g.baseNames.size === 1 && only ? only : g.strippedName }]
	})

	// Strict-system directories are scanned even with no candidates: their .m3u
	// files still need checking.
	const uniqueDirs = [...new Set([...candidates.map((c) => c.dir), ...strictDirs.keys()])]
	if (uniqueDirs.length === 0) return empty

	const existingM3uByDir = new Map<string, Set<string>>(uniqueDirs.map((d) => [d, new Set()]))

	try {
		// Single SSH call for all directories instead of one per dir
		const dirArgs = uniqueDirs.map((d) => shellQuote(d)).join(' ')
		const output = await ssh.exec(`find ${dirArgs} -maxdepth 1 -name '*.m3u' 2>/dev/null || true`)
		for (const line of output.split('\n').flatMap((s) => {
			const t = s.trim()
			return t ? [t] : []
		})) {
			const dir = dirname(line)
			const file = pathBasename(line)
			existingM3uByDir.get(dir)?.add(file)
		}
	} catch {
		// leave all dirs as empty sets — m3uAlreadyExists will be false
	}

	const resolved: MultiDiscGame[] = candidates.map(({ system: sys, dir, baseName, discs }) => {
		const sorted = discs.toSorted((a, b) => a.discNumber - b.discNumber)
		const m3uFileName = sanitizeM3uFileName(baseName)
		const nums = sorted.map((d) => d.discNumber)
		const hasGap = nums.some((n, i) => n !== i + 1)

		return {
			system: sys,
			baseName,
			m3uFileName,
			romsDir: dir,
			discs: sorted,
			m3uAlreadyExists: existingM3uByDir.get(dir)?.has(m3uFileName) ?? false,
			m3uNeedsRepair: false,
			hasGap,
		}
	})

	// Dolphin systems: presence is not enough, the bytes have to be right too.
	// Every .m3u in the directory is inspected, not just the ones a disc group
	// matched, because the discs are usually missing from the gamelist.
	const strictPaths: Array<{ system: string; dir: string; file: string }> = []
	for (const [dir, sys] of strictDirs) {
		for (const file of existingM3uByDir.get(dir) ?? []) {
			strictPaths.push({ system: sys, dir, file })
		}
	}

	const malformed: MalformedM3u[] = []
	if (strictPaths.length > 0) {
		const contents = await readM3uFiles(
			ssh,
			strictPaths.map((p) => `${p.dir}/${p.file}`),
		)
		const byPath = new Map(resolved.map((g) => [`${g.romsDir}/${g.m3uFileName}`, g]))

		for (const { system: sys, dir, file } of strictPaths) {
			const path = `${dir}/${file}`
			const raw = contents.get(path)
			if (raw === undefined || !m3uNeedsRepair(raw)) continue

			const candidate = byPath.get(path)
			if (candidate) candidate.m3uNeedsRepair = true
			else malformed.push({ system: sys, romsDir: dir, m3uFileName: file })
		}
	}

	return { candidates: resolved, malformed }
}

/** Marker that cannot appear in a ROM path, so it safely delimits the batch dump. */
const DUMP_MARKER = '@@M3U@@'

/**
 * Read several .m3u files in a single SSH round trip. Contents come back base64
 * encoded so CRLF, BOM and non-ASCII survive the shell and the SSH transport
 * untouched — the whole point is to inspect bytes we must not let anything fix
 * for us. Unreadable files are simply absent from the returned map.
 */
export async function readM3uFiles(
	ssh: SshClientLike,
	paths: string[],
): Promise<Map<string, string>> {
	const result = new Map<string, string>()
	if (paths.length === 0) return result

	const commands = paths.map(
		(p) => `echo ${shellQuote(DUMP_MARKER + p)}; base64 ${shellQuote(p)} 2>/dev/null || true`,
	)

	for (const chunk of chunkShellCommands(commands)) {
		let output: string
		try {
			output = await ssh.exec(chunk.join('; '))
		} catch {
			continue
		}

		let current: string | null = null
		let buffer: string[] = []
		const flush = () => {
			if (current === null) return
			const b64 = buffer.join('')
			if (b64) result.set(current, Buffer.from(b64, 'base64').toString('utf8'))
		}

		for (const line of output.split('\n')) {
			const trimmed = line.trim()
			if (trimmed.startsWith(DUMP_MARKER)) {
				flush()
				current = trimmed.slice(DUMP_MARKER.length)
				buffer = []
			} else if (current !== null && trimmed) {
				buffer.push(trimmed)
			}
		}
		flush()
	}

	return result
}
