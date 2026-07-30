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

/** List all Recalbox game systems that have a gamelist.xml, across every external support. */
export async function listSystems(ssh: SshClientLike): Promise<GameSystem[]> {
	if (cache && Date.now() < cache.expiresAt) return cache.systems

	const systems: GameSystem[] = []

	// Every external support, not just `usbN`: Recalbox mounts a NAS under the
	// same directory as `network0`…`network3`, and a `usb\d+` filter made those
	// collections invisible. A support with no `recalbox/roms` simply yields no
	// system, so accepting every entry costs one listing and nothing else.
	const disksOutput = await ssh.exec('ls -1 /recalbox/share/externals/ 2>/dev/null')
	const disks = disksOutput
		.split('\n')
		.map((d) => d.trim())
		.filter((d) => d !== '' && !d.startsWith('.') && d !== '..')

	for (const disk of disks) {
		const romsBase = `/recalbox/share/externals/${disk}/recalbox/roms`
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

	logger.info(`listSystems: found ${systems.length} systems across ${disks.length} disks`)
	cache = { systems, expiresAt: Date.now() + CACHE_TTL_MS }
	return systems
}

export function invalidateSystemsCache(): void {
	cache = null
}
