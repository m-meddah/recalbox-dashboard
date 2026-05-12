/**
 * Parser for gamelist-userdata.ini — Recalbox's per-system user preferences file.
 *
 * Format (one entry per line):
 *   relative/path/to/rom.ext:key1=val1,key2=val2,...
 *
 * Known keys: favorite, hidden, playcount, lastplayed, timeplayed
 */

import { parseRecalboxDate } from './gamelist-parser'

export type GameUserdata = {
	favorite?: boolean
	hidden?: boolean
	playCount?: number
	lastPlayed?: Date
}

/**
 * Parse a gamelist-userdata.ini string into a Map keyed by relative ROM path.
 * The paths match the <path> values from the corresponding gamelist.xml.
 */
export function parseUserdataIni(content: string): Map<string, GameUserdata> {
	const map = new Map<string, GameUserdata>()

	for (const rawLine of content.split('\n')) {
		const line = rawLine.trim()
		if (!line) continue

		const colonIdx = line.indexOf(':')
		if (colonIdx === -1) continue

		const relativePath = line.slice(0, colonIdx)
		const dataStr = line.slice(colonIdx + 1)
		if (!relativePath || !dataStr) continue

		const entry: GameUserdata = {}

		for (const pair of dataStr.split(',')) {
			const eqIdx = pair.indexOf('=')
			if (eqIdx === -1) continue
			const key = pair.slice(0, eqIdx).trim().toLowerCase()
			const val = pair.slice(eqIdx + 1).trim()

			switch (key) {
				case 'favorite':
					entry.favorite = val === 'true'
					break
				case 'hidden':
					entry.hidden = val === 'true'
					break
				case 'playcount':
					entry.playCount = Number.isNaN(Number(val)) ? undefined : Number(val)
					break
				case 'lastplayed':
					entry.lastPlayed = parseRecalboxDate(val)
					break
			}
		}

		map.set(relativePath, entry)
	}

	return map
}
