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
