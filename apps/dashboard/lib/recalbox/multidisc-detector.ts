import { basename as pathBasename, dirname } from 'node:path'
import { db } from '@/lib/db/index'
import { games } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { sanitizeM3uFileName } from './m3u-generator'
import { shellQuote } from './shell'
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
])

// Applied in order; baseName = filename portion BEFORE the match (trimEnd).
const DISC_PATTERNS: RegExp[] = [
	/\(\s*(?:disc|disk|cd)\s*[-_ ]*(\d+)(?:\s+of\s+\d+)?\s*\)/i,
	/\[\s*(?:disc|disk|cd)\s*[-_ ]*(\d+)(?:\s+of\s+\d+)?\s*\]/i,
	/(?:^|[\s\-_])(?:disc|disk|cd)\s*[-_ ]*(\d+)(?=$|[\s\-_])/i,
	/(?:^|[\s\-_])cd(\d+)(?=$|[\s\-_])/i,
]

export function detectDiscInfo(
	filename: string,
): { baseName: string; discNumber: number } | null {
	const stem = filename.replace(/\.[^.]+$/, '')

	for (const pattern of DISC_PATTERNS) {
		const match = pattern.exec(stem)
		if (!match) continue

		const discNumber = parseInt(match[1] ?? '', 10)
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
	const systemFilter = system ? (MULTIDISC_SYSTEMS.has(system) ? [system] : []) : [...MULTIDISC_SYSTEMS]

	if (systemFilter.length === 0) return []

	const systemSet = new Set(systemFilter)

	const rows = db
		.select({ system: games.system, romPath: games.romPath })
		.from(games)
		.where(and(inArray(games.system, systemFilter), eq(games.recalboxId, recalboxId)))
		.all()

	type Group = { system: string; dir: string; baseName: string; discs: DiscEntry[] }
	const groups = new Map<string, Group>()

	for (const row of rows) {
		if (!systemSet.has(row.system)) continue
		if (!row.romPath) continue
		const fileName = pathBasename(row.romPath)
		const dir = dirname(row.romPath)
		const info = detectDiscInfo(fileName)
		if (!info) continue

		const key = `${row.system}\0${dir}\0${info.baseName}`
		let group = groups.get(key)
		if (!group) {
			group = { system: row.system, dir, baseName: info.baseName, discs: [] }
			groups.set(key, group)
		}
		group.discs.push({ fileName, discNumber: info.discNumber })
	}

	const candidates = [...groups.values()].filter((g) => g.discs.length >= 2)
	if (candidates.length === 0) return []

	const uniqueDirs = [...new Set(candidates.map((c) => c.dir))]
	const existingM3uByDir = new Map<string, Set<string>>(uniqueDirs.map((d) => [d, new Set()]))

	try {
		// Single SSH call for all directories instead of one per dir
		const dirArgs = uniqueDirs.map((d) => shellQuote(d)).join(' ')
		const output = await ssh.exec(
			`find ${dirArgs} -maxdepth 1 -name '*.m3u' 2>/dev/null || true`,
		)
		for (const line of output.split('\n').map((s) => s.trim()).filter(Boolean)) {
			const dir = dirname(line)
			const file = pathBasename(line)
			existingM3uByDir.get(dir)?.add(file)
		}
	} catch {
		// leave all dirs as empty sets — m3uAlreadyExists will be false
	}

	return candidates.map(({ system: sys, dir, baseName, discs }) => {
		const sorted = [...discs].sort((a, b) => a.discNumber - b.discNumber)
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
			hasGap,
		}
	})
}
