// Pure system id → display name + emoji map. No server-only imports, so it can be
// used from both server code (lib/recalbox/systems.ts, the icon proxy) and client
// components (now-playing emoji fallback).

export type SystemMeta = {
	name: string
	emoji: string
	/** Reference catalogue in libretro-database. Absent = inventory only, no completion figure. */
	datSource?: 'no-intro' | 'redump' | 'mame' | 'fbneo-split'
	datFile?: string
	/**
	 * How the scanner identifies this system's files.
	 *
	 * Absent means 'content': hash the ROM inside the archive, which is what
	 * No-Intro and Redump catalogue. The arcade catalogues instead hash the
	 * archive itself — all 30 038 rom entries of MAME.dat are named `*.zip` —
	 * so their systems need 'container'.
	 */
	hashMode?: 'content' | 'container'
	ssConsoleId?: number
}

export const SYSTEM_META: Record<string, SystemMeta> = {
	'3do': {
		name: '3DO',
		emoji: '🎮',
		datSource: 'redump',
		datFile: 'The 3DO Company - 3DO.dat',
	},
	'64dd': {
		name: 'N64 Disk Drive',
		emoji: '💾',
		datSource: 'no-intro',
		datFile: 'Nintendo - Nintendo 64DD.dat',
	},
	amiga1200: { name: 'Amiga 1200', emoji: '🖥️' },
	amiga600: { name: 'Amiga 600', emoji: '🖥️' },
	amigacd32: {
		name: 'Amiga CD32',
		emoji: '💿',
		datSource: 'redump',
		datFile: 'Commodore - CD32.dat',
	},
	amigacdtv: {
		name: 'Amiga CDTV',
		emoji: '📺',
		datSource: 'redump',
		datFile: 'Commodore - CDTV.dat',
	},
	amstradcpc: { name: 'Amstrad CPC', emoji: '🖥️' },
	apple2: { name: 'Apple II', emoji: '🍎' },
	apple2gs: { name: 'Apple IIGS', emoji: '🍎' },
	arduboy: {
		name: 'Arduboy',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Arduboy Inc - Arduboy.dat',
	},
	atari2600: {
		name: 'Atari 2600',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Atari - 2600.dat',
	},
	atari5200: {
		name: 'Atari 5200',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Atari - 5200.dat',
	},
	atari7800: {
		name: 'Atari 7800',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Atari - 7800.dat',
	},
	atari800: {
		name: 'Atari 800',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Atari - 8-bit Family.dat',
	},
	atarist: {
		name: 'Atari ST',
		emoji: '🖥️',
		datSource: 'no-intro',
		datFile: 'Atari - ST.dat',
	},
	atomiswave: { name: 'Atomiswave', emoji: '🕹️' },
	c64: {
		name: 'Commodore 64',
		emoji: '🖥️',
		datSource: 'no-intro',
		datFile: 'Commodore - 64.dat',
	},
	cdi: {
		name: 'CD-i',
		emoji: '💿',
		datSource: 'redump',
		datFile: 'Philips - CD-i.dat',
	},
	channelf: {
		name: 'Channel F',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Fairchild - Channel F.dat',
	},
	colecovision: {
		name: 'ColecoVision',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Coleco - ColecoVision.dat',
	},
	dreamcast: {
		name: 'Dreamcast',
		emoji: '🌀',
		datSource: 'redump',
		datFile: 'Sega - Dreamcast.dat',
	},
	fbneo: {
		name: 'FinalBurn Neo',
		emoji: '👾',
		datSource: 'fbneo-split',
		datFile: 'FBNeo - Arcade Games.dat',
		hashMode: 'container',
	},
	fds: {
		name: 'Famicom Disk System',
		emoji: '💾',
		datSource: 'no-intro',
		datFile: 'Nintendo - Family Computer Disk System.dat',
	},
	gamecube: {
		name: 'GameCube',
		emoji: '🟣',
		datSource: 'redump',
		datFile: 'Nintendo - GameCube.dat',
	},
	gamegear: {
		name: 'Game Gear',
		emoji: '🎮',
		datSource: 'no-intro',
		datFile: 'Sega - Game Gear.dat',
	},
	gb: {
		name: 'Game Boy',
		emoji: '🟩',
		datSource: 'no-intro',
		datFile: 'Nintendo - Game Boy.dat',
	},
	gba: {
		name: 'Game Boy Advance',
		emoji: '🟦',
		datSource: 'no-intro',
		datFile: 'Nintendo - Game Boy Advance.dat',
	},
	gbc: {
		name: 'Game Boy Color',
		emoji: '🌈',
		datSource: 'no-intro',
		datFile: 'Nintendo - Game Boy Color.dat',
	},
	gw: { name: 'Game & Watch', emoji: '⌚' },
	gx4000: { name: 'GX4000', emoji: '🕹️' },
	intellivision: {
		name: 'Intellivision',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Mattel - Intellivision.dat',
	},
	jaguar: {
		name: 'Atari Jaguar',
		emoji: '🐆',
		datSource: 'no-intro',
		datFile: 'Atari - Jaguar.dat',
	},
	lutro: { name: 'Lutro', emoji: '🕹️' },
	lynx: {
		name: 'Atari Lynx',
		emoji: '🎮',
		datSource: 'no-intro',
		datFile: 'Atari - Lynx.dat',
	},
	mame: {
		name: 'MAME',
		emoji: '👾',
		datSource: 'mame',
		datFile: 'MAME.dat',
		hashMode: 'container',
	},
	mastersystem: {
		name: 'Master System',
		emoji: '⚫',
		datSource: 'no-intro',
		datFile: 'Sega - Master System - Mark III.dat',
	},
	megadrive: {
		name: 'Mega Drive',
		emoji: '🔵',
		datSource: 'no-intro',
		datFile: 'Sega - Mega Drive - Genesis.dat',
	},
	megaduck: { name: 'Mega Duck', emoji: '🦆' },
	model3: { name: 'Model 3', emoji: '🕹️' },
	msx1: {
		name: 'MSX',
		emoji: '🖥️',
		datSource: 'no-intro',
		datFile: 'Microsoft - MSX.dat',
	},
	msx2: {
		name: 'MSX2',
		emoji: '🖥️',
		datSource: 'no-intro',
		datFile: 'Microsoft - MSX2.dat',
	},
	multivision: { name: 'Multivision', emoji: '🕹️' },
	n64: {
		name: 'Nintendo 64',
		emoji: '🔴',
		datSource: 'no-intro',
		datFile: 'Nintendo - Nintendo 64.dat',
	},
	naomi: { name: 'Naomi', emoji: '🕹️' },
	naomi2: { name: 'Naomi 2', emoji: '🕹️' },
	naomigd: { name: 'Naomi GD-ROM', emoji: '💿' },
	nds: {
		name: 'Nintendo DS',
		emoji: '📱',
		datSource: 'no-intro',
		datFile: 'Nintendo - Nintendo DS.dat',
	},
	neogeo: {
		name: 'Neo Geo',
		emoji: '🔴',
		// Neo Geo MVS/AES sets live in the arcade catalogues, not in a No-Intro
		// one. Which of MAME or FBNeo covers this collection best is decided by
		// measurement, not by assumption — see the plan's task 2 step 5.
		datSource: 'fbneo-split',
		datFile: 'FBNeo - Arcade Games.dat',
		hashMode: 'container',
	},
	neogeocd: {
		name: 'Neo Geo CD',
		emoji: '💿',
		datSource: 'redump',
		datFile: 'SNK - Neo Geo CD.dat',
	},
	nes: {
		name: 'NES',
		emoji: '🍄',
		datSource: 'no-intro',
		datFile: 'Nintendo - Nintendo Entertainment System.dat',
	},
	ngp: {
		name: 'Neo Geo Pocket',
		emoji: '🎮',
		datSource: 'no-intro',
		datFile: 'SNK - Neo Geo Pocket.dat',
	},
	ngpc: {
		name: 'Neo Geo Pocket Color',
		emoji: '🌈',
		datSource: 'no-intro',
		datFile: 'SNK - Neo Geo Pocket Color.dat',
	},
	o2em: {
		name: 'Odyssey²',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Magnavox - Odyssey2.dat',
	},
	oricatmos: { name: 'Oric-Atmos', emoji: '🖥️' },
	pcengine: {
		name: 'PC Engine',
		emoji: '⚪',
		datSource: 'no-intro',
		datFile: 'NEC - PC Engine - TurboGrafx 16.dat',
	},
	pcenginecd: {
		name: 'PC Engine CD',
		emoji: '💿',
		datSource: 'redump',
		datFile: 'NEC - PC Engine CD - TurboGrafx-CD.dat',
	},
	pcfx: {
		name: 'PC-FX',
		emoji: '🎮',
		datSource: 'redump',
		datFile: 'NEC - PC-FX.dat',
	},
	pico: { name: 'Pico-8', emoji: '🎮' },
	pokemini: {
		name: 'Pokémon Mini',
		emoji: '🟡',
		datSource: 'no-intro',
		datFile: 'Nintendo - Pokemon Mini.dat',
	},
	psp: {
		name: 'PSP',
		emoji: '📺',
		datSource: 'redump',
		datFile: 'Sony - PlayStation Portable.dat',
	},
	psx: {
		name: 'PlayStation',
		emoji: '🔲',
		datSource: 'redump',
		datFile: 'Sony - PlayStation.dat',
	},
	satellaview: {
		name: 'Satellaview',
		emoji: '📡',
		datSource: 'no-intro',
		datFile: 'Nintendo - Satellaview.dat',
	},
	saturn: {
		name: 'Saturn',
		emoji: '🪐',
		datSource: 'redump',
		datFile: 'Sega - Saturn.dat',
	},
	scummvm: { name: 'ScummVM', emoji: '🖱️' },
	sega32x: {
		name: 'Sega 32X',
		emoji: '🔴',
		datSource: 'no-intro',
		datFile: 'Sega - 32X.dat',
	},
	segacd: {
		name: 'Sega CD',
		emoji: '💿',
		datSource: 'redump',
		datFile: 'Sega - Mega-CD - Sega CD.dat',
	},
	sg1000: {
		name: 'SG-1000',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'Sega - SG-1000.dat',
	},
	snes: {
		name: 'Super Nintendo',
		emoji: '🟣',
		datSource: 'no-intro',
		datFile: 'Nintendo - Super Nintendo Entertainment System.dat',
		ssConsoleId: 4,
	},
	supervision: {
		name: 'Supervision',
		emoji: '🎮',
		datSource: 'no-intro',
		datFile: 'Watara - Supervision.dat',
	},
	vectrex: {
		name: 'Vectrex',
		emoji: '🕹️',
		datSource: 'no-intro',
		datFile: 'GCE - Vectrex.dat',
	},
	vic20: {
		name: 'VIC-20',
		emoji: '🖥️',
		datSource: 'no-intro',
		datFile: 'Commodore - VIC-20.dat',
	},
	virtualboy: {
		name: 'Virtual Boy',
		emoji: '🔴',
		datSource: 'no-intro',
		datFile: 'Nintendo - Virtual Boy.dat',
	},
	wii: {
		name: 'Wii',
		emoji: '🎯',
		datSource: 'redump',
		datFile: 'Nintendo - Wii.dat',
	},
	wswan: {
		name: 'WonderSwan',
		emoji: '🎮',
		datSource: 'no-intro',
		datFile: 'Bandai - WonderSwan.dat',
	},
	wswanc: {
		name: 'WonderSwan Color',
		emoji: '🌈',
		datSource: 'no-intro',
		datFile: 'Bandai - WonderSwan Color.dat',
	},
	x68000: {
		name: 'X68000',
		emoji: '🖥️',
		datSource: 'no-intro',
		datFile: 'Sharp - X68000.dat',
	},
	zx81: { name: 'ZX81', emoji: '🖥️' },
	zxspectrum: { name: 'ZX Spectrum', emoji: '🌈' },
}

export function systemMeta(id: string): SystemMeta {
	return SYSTEM_META[id] ?? { name: id.toUpperCase(), emoji: '🎮' }
}

export function systemEmoji(id: string): string {
	return systemMeta(id).emoji
}
