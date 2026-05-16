export const SR_SYSTEM_SLUGS: Record<string, string> = {
	snes: 'super-nintendo',
	nes: 'nes',
	megadrive: 'megadrive',
	gb: 'game-boy',
	gbc: 'game-boy-color',
	gba: 'game-boy-advance',
	psx: 'playstation',
	ps2: 'playstation-2',
	ps3: 'playstation-3',
	psp: 'psp',
	gc: 'gamecube',
	n64: 'nintendo-64',
	nds: 'nintendo-ds',
	wii: 'wii',
	dreamcast: 'dreamcast',
	saturn: 'saturn',
	segacd: 'mega-cd',
	megadrive32x: 'megadrive-32x',
	gamegear: 'game-gear',
	mastersystem: 'master-system',
	neogeo: 'neo-geo',
	neogeocd: 'neo-geo-cd',
	neogeopocket: 'neo-geo-pocket',
	neogeopocketcolor: 'neo-geo-pocket-color',
	atari2600: 'atari-2600',
	atari5200: 'atari-5200',
	atari7800: 'atari-7800',
	lynx: 'lynx',
	jaguar: 'jaguar',
	jaguarcd: 'jaguar-cd',
	msx: 'msx',
	msx2: 'msx2',
	pcengine: 'pc-engine',
	pcenginecd: 'pc-engine-cd-rom',
	supergrafx: 'pc-engine-supergrafx',
	pcfx: 'pc-fx',
	fds: 'family-computer-disk-system',
	virtualboy: 'virtual-boy',
	wonderswan: 'wonderswan',
	wonderswancolor: 'wonderswan-color',
	xbox: 'xbox',
	xbox360: 'xbox-360',
	'3do': '3do',
	intellivision: 'intellivision',
	colecovision: 'colecovision',
	vectrex: 'vectrex',
	channelf: 'channel-f',
	amigacd32: 'amiga-cd32',
	amigacdtv: 'amiga-cdtv',
	gx4000: 'gx4000',
	'msx-turbo-r': 'msx-turbo-r',
}

function normaliseName(raw: string): string {
	return (
		raw
			// Remove file extension
			.replace(/\.[a-zA-Z0-9]{1,5}$/, '')
			// Remove anything in (...) or [...]
			.replace(/\s*\([^)]*\)\s*/g, ' ')
			.replace(/\s*\[[^\]]*\]\s*/g, ' ')
			.trim()
			// Decompose accents → strip diacritics
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			// Remove apostrophes and selected punctuation
			.replace(/[''`]/g, '')
			.replace(/[:.!?,;]/g, '')
			// Hyphens, underscores, spaces → single dash
			.replace(/[-_\s]+/g, '-')
			// Strip anything that's not alphanumeric or dash
			.replace(/[^a-z0-9-]/g, '')
			// Collapse repeated dashes, trim edges
			.replace(/-+/g, '-')
			.replace(/^-+|-+$/g, '')
	)
}

export function gameToSlug(name: string, system: string): string | null {
	const consoleSlug = SR_SYSTEM_SLUGS[system]
	if (!consoleSlug) return null
	const normalised = normaliseName(name)
	if (!normalised) return null
	return `${normalised}-console-${consoleSlug}`
}

export function gameToSlugVariants(name: string, system: string): string[] {
	const primary = gameToSlug(name, system)
	if (!primary) return []
	const consoleSlug = SR_SYSTEM_SLUGS[system] as string
	const namePart = primary.slice(0, primary.length - `-console-${consoleSlug}`.length)
	const variants: string[] = [primary]
	if (namePart.startsWith('the-')) {
		const withoutThe = namePart.slice(4)
		variants.push(`${withoutThe}-the-console-${consoleSlug}`)
	}
	return variants
}

export function slugToParts(slug: string): { name: string; system: string } | null {
	const idx = slug.lastIndexOf('-console-')
	if (idx === -1) return null
	const namePart = slug.slice(0, idx)
	const consoleSlug = slug.slice(idx + '-console-'.length)
	const system = Object.entries(SR_SYSTEM_SLUGS).find(([, v]) => v === consoleSlug)?.[0]
	if (!system) return null
	return { name: namePart, system }
}
