export const SR_REGIONS = ['FR', 'EU', 'WOR', 'JP', 'US', 'ASI'] as const

export type SrRegion = (typeof SR_REGIONS)[number]

/** ScreenScraper region codes / common aliases → Super Retrogamers region. */
const ROM_REGION_MAP: Record<string, SrRegion> = {
	fr: 'FR',
	france: 'FR',
	eu: 'EU',
	europe: 'EU',
	wor: 'WOR',
	world: 'WOR',
	jp: 'JP',
	japan: 'JP',
	us: 'US',
	usa: 'US',
	asi: 'ASI',
	asia: 'ASI',
}

/**
 * Map a gamelist `<region>` value (ScreenScraper code, possibly comma-separated)
 * to an SR region. Returns the first token that maps, or null when none do.
 */
export function mapRomRegionToSr(romRegion?: string | null): SrRegion | null {
	if (!romRegion) return null
	for (const token of romRegion.split(',')) {
		const mapped = ROM_REGION_MAP[token.trim().toLowerCase()]
		if (mapped) return mapped
	}
	return null
}

/**
 * Resolve the region to request: the ROM's mapped region, else the global
 * preference, else '' (no `region` param → API defaults to FR).
 */
export function resolveRegion(
	romRegion: string | null | undefined,
	preferredRegion: SrRegion | '',
): SrRegion | '' {
	return mapRomRegionToSr(romRegion) ?? (preferredRegion || '')
}
