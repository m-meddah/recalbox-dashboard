import { type ParsedGame, parseGamelist } from '@/lib/recalbox/gamelist-parser'
import { parseUserdataIni } from '@/lib/recalbox/userdata-parser'

const GAMELIST_PATH_RE = /\/externals\/(usb\d+)\/recalbox\/roms\/([^/]+)\/gamelist\.xml$/

export type DerivedSystem = { id: string; romsBasePath: string; diskSource: string }

/**
 * Derive {system id, romsBasePath, diskSource} from an absolute gamelist path,
 * matching how listSystems() discovers systems (external USB roms only):
 *   /recalbox/share/externals/<usbN>/recalbox/roms/<system>/gamelist.xml
 * Returns null for ports, hidden dirs, or paths that don't fit the convention.
 */
export function deriveSystemFromGamelistPath(gamelistPath: string): DerivedSystem | null {
	const m = GAMELIST_PATH_RE.exec(gamelistPath)
	if (!m) return null
	const diskSource = m[1] as string
	const id = m[2] as string
	if (id === 'ports' || id.startsWith('.')) return null
	const romsBasePath = gamelistPath.slice(0, -'/gamelist.xml'.length)
	return { id, romsBasePath, diskSource }
}

/**
 * Parse a system's gamelist.xml and apply gamelist-userdata.ini overrides
 * (favorite / hidden / play stats win over the XML) — the same merge the SSH
 * collection sync performs, reused here for agent-uploaded files.
 */
export function parseSystemGames(
	gamelistXml: string,
	romsBasePath: string,
	userdataIni?: string | null,
): ParsedGame[] {
	const parsed = parseGamelist(gamelistXml, romsBasePath)
	if (userdataIni) {
		const userdata = parseUserdataIni(userdataIni)
		for (const game of parsed) {
			const ud = userdata.get(game.relativeRomPath)
			if (!ud) continue
			if (ud.favorite !== undefined) game.favorite = ud.favorite
			if (ud.hidden !== undefined) game.hidden = ud.hidden
			if (ud.playCount !== undefined) game.playCount = ud.playCount
			if (ud.lastPlayed !== undefined) game.lastPlayed = ud.lastPlayed
			if (ud.timePlayedSeconds !== undefined) game.playTimeSeconds = ud.timePlayedSeconds
		}
	}
	return parsed
}
