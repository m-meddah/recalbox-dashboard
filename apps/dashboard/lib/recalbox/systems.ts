import { logger } from '@/lib/logger'
import { shellQuote } from './shell'
import { sshClient } from './ssh-client'

export type GameSystem = {
	id: string
	name: string
	emoji: string
	diskSource: string
	gamelistPath: string
	romsBasePath: string
}

// Mapping system id → display name + emoji
const SYSTEM_META: Record<string, { name: string; emoji: string }> = {
	'3do': { name: '3DO', emoji: '🎮' },
	'64dd': { name: 'N64 Disk Drive', emoji: '💾' },
	amiga1200: { name: 'Amiga 1200', emoji: '🖥️' },
	amiga600: { name: 'Amiga 600', emoji: '🖥️' },
	amigacd32: { name: 'Amiga CD32', emoji: '💿' },
	amigacdtv: { name: 'Amiga CDTV', emoji: '📺' },
	amstradcpc: { name: 'Amstrad CPC', emoji: '🖥️' },
	apple2: { name: 'Apple II', emoji: '🍎' },
	apple2gs: { name: 'Apple IIGS', emoji: '🍎' },
	arduboy: { name: 'Arduboy', emoji: '🕹️' },
	atari2600: { name: 'Atari 2600', emoji: '🕹️' },
	atari5200: { name: 'Atari 5200', emoji: '🕹️' },
	atari7800: { name: 'Atari 7800', emoji: '🕹️' },
	atari800: { name: 'Atari 800', emoji: '🕹️' },
	atarist: { name: 'Atari ST', emoji: '🖥️' },
	atomiswave: { name: 'Atomiswave', emoji: '🕹️' },
	c64: { name: 'Commodore 64', emoji: '🖥️' },
	cdi: { name: 'CD-i', emoji: '💿' },
	channelf: { name: 'Channel F', emoji: '🕹️' },
	colecovision: { name: 'ColecoVision', emoji: '🕹️' },
	dreamcast: { name: 'Dreamcast', emoji: '🌀' },
	fbneo: { name: 'FinalBurn Neo', emoji: '👾' },
	fds: { name: 'Famicom Disk System', emoji: '💾' },
	gamecube: { name: 'GameCube', emoji: '🟣' },
	gamegear: { name: 'Game Gear', emoji: '🎮' },
	gb: { name: 'Game Boy', emoji: '🟩' },
	gba: { name: 'Game Boy Advance', emoji: '🟦' },
	gbc: { name: 'Game Boy Color', emoji: '🌈' },
	gw: { name: 'Game & Watch', emoji: '⌚' },
	gx4000: { name: 'GX4000', emoji: '🕹️' },
	intellivision: { name: 'Intellivision', emoji: '🕹️' },
	jaguar: { name: 'Atari Jaguar', emoji: '🐆' },
	lutro: { name: 'Lutro', emoji: '🕹️' },
	lynx: { name: 'Atari Lynx', emoji: '🎮' },
	mame: { name: 'MAME', emoji: '👾' },
	mastersystem: { name: 'Master System', emoji: '⚫' },
	megadrive: { name: 'Mega Drive', emoji: '🔵' },
	megaduck: { name: 'Mega Duck', emoji: '🦆' },
	model3: { name: 'Model 3', emoji: '🕹️' },
	msx1: { name: 'MSX', emoji: '🖥️' },
	msx2: { name: 'MSX2', emoji: '🖥️' },
	multivision: { name: 'Multivision', emoji: '🕹️' },
	n64: { name: 'Nintendo 64', emoji: '🔴' },
	naomi: { name: 'Naomi', emoji: '🕹️' },
	naomi2: { name: 'Naomi 2', emoji: '🕹️' },
	naomigd: { name: 'Naomi GD-ROM', emoji: '💿' },
	nds: { name: 'Nintendo DS', emoji: '📱' },
	neogeo: { name: 'Neo Geo', emoji: '🔴' },
	neogeocd: { name: 'Neo Geo CD', emoji: '💿' },
	nes: { name: 'NES', emoji: '🍄' },
	ngp: { name: 'Neo Geo Pocket', emoji: '🎮' },
	ngpc: { name: 'Neo Geo Pocket Color', emoji: '🌈' },
	o2em: { name: 'Odyssey²', emoji: '🕹️' },
	oricatmos: { name: 'Oric-Atmos', emoji: '🖥️' },
	pcengine: { name: 'PC Engine', emoji: '⚪' },
	pcenginecd: { name: 'PC Engine CD', emoji: '💿' },
	pcfx: { name: 'PC-FX', emoji: '🎮' },
	pico: { name: 'Pico-8', emoji: '🎮' },
	pokemini: { name: 'Pokémon Mini', emoji: '🟡' },
	psp: { name: 'PSP', emoji: '📺' },
	psx: { name: 'PlayStation', emoji: '🔲' },
	satellaview: { name: 'Satellaview', emoji: '📡' },
	saturn: { name: 'Saturn', emoji: '🪐' },
	scummvm: { name: 'ScummVM', emoji: '🖱️' },
	sega32x: { name: 'Sega 32X', emoji: '🔴' },
	segacd: { name: 'Sega CD', emoji: '💿' },
	sg1000: { name: 'SG-1000', emoji: '🕹️' },
	snes: { name: 'Super Nintendo', emoji: '🟣' },
	supervision: { name: 'Supervision', emoji: '🎮' },
	vectrex: { name: 'Vectrex', emoji: '🕹️' },
	vic20: { name: 'VIC-20', emoji: '🖥️' },
	virtualboy: { name: 'Virtual Boy', emoji: '🔴' },
	wii: { name: 'Wii', emoji: '🎯' },
	wswan: { name: 'WonderSwan', emoji: '🎮' },
	wswanc: { name: 'WonderSwan Color', emoji: '🌈' },
	x68000: { name: 'X68000', emoji: '🖥️' },
	zx81: { name: 'ZX81', emoji: '🖥️' },
	zxspectrum: { name: 'ZX Spectrum', emoji: '🌈' },
}

function systemMeta(id: string) {
	return SYSTEM_META[id] ?? { name: id.toUpperCase(), emoji: '🎮' }
}

// In-memory cache: { systems, expiresAt }
let cache: { systems: GameSystem[]; expiresAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/** List all Recalbox game systems that have a gamelist.xml, across all USB disks. */
export async function listSystems(): Promise<GameSystem[]> {
	if (cache && Date.now() < cache.expiresAt) return cache.systems

	const systems: GameSystem[] = []

	// Discover mounted USB disks under /recalbox/share/externals/
	const disksOutput = await sshClient.exec('ls -1 /recalbox/share/externals/ 2>/dev/null')
	const disks = disksOutput
		.split('\n')
		.map((d) => d.trim())
		.filter((d) => /^usb\d+$/.test(d))

	for (const disk of disks) {
		const romsBase = `/recalbox/share/externals/${disk}/recalbox/roms`
		const dirsOutput = await sshClient.exec(`ls -1 ${shellQuote(romsBase)} 2>/dev/null`)
		const dirs = dirsOutput
			.split('\n')
			.map((d) => d.trim())
			.filter(Boolean)

		for (const dir of dirs) {
			// Skip ports (nested gamelists) and hidden dirs
			if (dir === 'ports' || dir.startsWith('.')) continue

			const gamelistPath = `${romsBase}/${dir}/gamelist.xml`
			const exists = await sshClient.exec(
				`test -f ${shellQuote(gamelistPath)} && echo yes || echo no`,
			)
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
