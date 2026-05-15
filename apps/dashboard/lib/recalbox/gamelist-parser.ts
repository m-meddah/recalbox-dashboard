import { logger } from '@/lib/logger'
import { XMLParser } from 'fast-xml-parser'

export type ParsedGame = {
	romPath: string
	relativeRomPath: string
	name: string
	description?: string
	imagePath?: string
	videoPath?: string
	thumbnailPath?: string
	rating?: number
	releaseDate?: Date
	developer?: string
	publisher?: string
	genre?: string
	players?: string
	favorite: boolean
	hidden: boolean
	playCount?: number
	lastPlayed?: Date
	hash?: string
	region?: string
}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	parseAttributeValue: true,
	parseTagValue: false,
	trimValues: true,
	isArray: (name) => name === 'game' || name === 'folder',
})

/**
 * Parse a Recalbox date string (YYYYMMDDTHHMMSS) into a Date.
 * Returns undefined for empty or malformed values.
 */
export function parseRecalboxDate(raw: unknown): Date | undefined {
	if (!raw || typeof raw !== 'string') return undefined
	// Format: 19960322T000000
	const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/)
	if (!match) return undefined
	const [, y, mo, d, h, mi, s] = match
	const date = new Date(
		Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
	)
	return Number.isNaN(date.getTime()) ? undefined : date
}

function toBoolean(val: unknown): boolean {
	if (typeof val === 'boolean') return val
	if (typeof val === 'string') return val.toLowerCase() === 'true'
	return false
}

function toNumber(val: unknown): number | undefined {
	if (val === undefined || val === null || val === '') return undefined
	const n = Number(val)
	return Number.isNaN(n) ? undefined : n
}

/**
 * Resolve a relative path from the gamelist to an absolute Recalbox path.
 * Strips leading "./" if present.
 */
function resolvePath(relative: string, romsBasePath: string): string {
	const stripped = relative.replace(/^\.\//, '')
	return `${romsBasePath}/${stripped}`
}

/**
 * Parse a gamelist.xml string into an array of ParsedGame objects.
 * @param xml - Raw XML content
 * @param romsBasePath - Absolute path on Recalbox FS, e.g. /recalbox/share/externals/usb0/recalbox/roms/snes
 */
export function parseGamelist(xml: string, romsBasePath: string): ParsedGame[] {
	let parsed: unknown
	try {
		parsed = parser.parse(xml)
	} catch (err) {
		logger.warn(`parseGamelist: XML parse error for ${romsBasePath}`, err)
		return []
	}

	const root = (parsed as Record<string, unknown>)?.gameList
	if (!root || typeof root !== 'object') return []

	const rawGames = (root as Record<string, unknown>).game
	if (!Array.isArray(rawGames) || rawGames.length === 0) return []

	const results: ParsedGame[] = []

	for (const raw of rawGames) {
		if (!raw || typeof raw !== 'object') continue
		const g = raw as Record<string, unknown>

		const path = typeof g.path === 'string' ? g.path.trim() : ''
		const name = typeof g.name === 'string' ? g.name.trim() : ''

		if (!path) {
			logger.warn(`parseGamelist(${romsBasePath}): skipping game with no <path>`)
			continue
		}
		if (!name) {
			logger.warn(`parseGamelist(${romsBasePath}): skipping game with no <name> (path: ${path})`)
			continue
		}

		const relativeRomPath = path.replace(/^\.\//, '')
		const romPath = `${romsBasePath}/${relativeRomPath}`
		const imagePath = g.image ? resolvePath(String(g.image), romsBasePath) : undefined
		const videoPath = g.video ? resolvePath(String(g.video), romsBasePath) : undefined
		const thumbnailPath = g.thumbnail ? resolvePath(String(g.thumbnail), romsBasePath) : undefined

		results.push({
			romPath,
			relativeRomPath,
			name,
			description: g.desc ? String(g.desc) : undefined,
			imagePath,
			videoPath,
			thumbnailPath,
			rating: toNumber(g.rating),
			releaseDate: parseRecalboxDate(g.releasedate),
			developer: g.developer ? String(g.developer) : undefined,
			publisher: g.publisher ? String(g.publisher) : undefined,
			genre: g.genre ? String(g.genre) : undefined,
			players: g.players ? String(g.players) : undefined,
			favorite: toBoolean(g.favorite),
			hidden: toBoolean(g.hidden),
			playCount: toNumber(g.playcount),
			lastPlayed: parseRecalboxDate(g.lastplayed),
			hash: g.hash ? String(g.hash) : undefined,
			region: g.region ? String(g.region) : undefined,
		})
	}

	return results
}
