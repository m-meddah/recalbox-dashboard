import { logger } from '@/lib/logger'
import { shellQuote } from './shell'
import type { SshClientLike } from './ssh-client'
import { systemMeta } from './system-meta'

export type GameSystem = {
	id: string
	name: string
	emoji: string
	diskSource: string
	gamelistPath: string
	romsBasePath: string
}

// In-memory cache: { systems, expiresAt }
let cache: { systems: GameSystem[]; expiresAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/** The SD card's own roms directory, and the `diskSource` recorded for it. */
export const SD_CARD_SOURCE = 'share'
const SD_CARD_ROMS = '/recalbox/share/roms'

/**
 * Every support holding ROMs, as `{ diskSource, romsBase }`.
 *
 * Two sources, and both matter:
 *
 * - **The SD card** (`/recalbox/share/roms`). Long ignored: the listing only
 *   ever looked at the external disks, so a system living on the card was
 *   invisible to the whole dashboard — silently, with no error anywhere.
 * - **Every external support**, not just `usbN`: Recalbox mounts a NAS in the
 *   same directory as `network0`…`network3`, and the reference box also exposes
 *   `usb0` through `usb7`. A support with no `recalbox/roms` simply yields no
 *   system, so accepting every entry costs one listing and nothing else.
 */
async function romsRoots(ssh: SshClientLike): Promise<{ diskSource: string; romsBase: string }[]> {
	const roots = [{ diskSource: SD_CARD_SOURCE, romsBase: SD_CARD_ROMS }]

	const disksOutput = await ssh.exec('ls -1 /recalbox/share/externals/ 2>/dev/null')
	for (const raw of disksOutput.split('\n')) {
		const disk = raw.trim()
		if (disk === '' || disk === '..' || disk.startsWith('.')) continue
		roots.push({
			diskSource: disk,
			romsBase: `/recalbox/share/externals/${disk}/recalbox/roms`,
		})
	}
	return roots
}

/** List all Recalbox game systems that have a gamelist.xml, across every support. */
export async function listSystems(ssh: SshClientLike): Promise<GameSystem[]> {
	if (cache && Date.now() < cache.expiresAt) return cache.systems

	const systems: GameSystem[] = []
	const roots = await romsRoots(ssh)

	for (const { diskSource: disk, romsBase } of roots) {
		const dirsOutput = await ssh.exec(`ls -1 ${shellQuote(romsBase)} 2>/dev/null`)
		const dirs = dirsOutput.split('\n').flatMap((d) => {
			const t = d.trim()
			return t ? [t] : []
		})

		for (const dir of dirs) {
			// Skip ports (nested gamelists) and hidden dirs
			if (dir === 'ports' || dir.startsWith('.')) continue

			const gamelistPath = `${romsBase}/${dir}/gamelist.xml`
			const exists = await ssh.exec(`test -f ${shellQuote(gamelistPath)} && echo yes || echo no`)
			if (exists === 'yes') {
				const meta = systemMeta(dir)
				systems.push({
					id: dir,
					name: meta.name,
					emoji: meta.emoji,
					diskSource: disk,
					gamelistPath,
					romsBasePath: `${romsBase}/${dir}`,
				})
			}
		}
	}

	logger.info(`listSystems: found ${systems.length} systems across ${roots.length} supports`)
	cache = { systems, expiresAt: Date.now() + CACHE_TTL_MS }
	return systems
}

export function invalidateSystemsCache(): void {
	cache = null
}
