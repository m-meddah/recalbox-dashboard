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

		const discNumber = parseInt(match[1], 10)
		if (discNumber < 1 || discNumber > 10) return null

		const baseName = stem.slice(0, match.index).trimEnd()
		if (!baseName) return null

		return { baseName, discNumber }
	}
	return null
}
