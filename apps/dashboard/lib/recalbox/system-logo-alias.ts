/**
 * A handful of EmulationStation system ids don't match the logo filename in the
 * recalbox-next theme's `systems_logos/` dir: the theme names those by the
 * canonical console name (from recalbox `systemlist.xml` `<descriptor theme=…>`),
 * so `<id>.png` is absent while the theme-named file exists.
 *
 * Map id → logo basename for exactly those cases (verified against the shipped
 * recalbox-next theme: the target `<theme>.png` exists and `<id>.png` does not).
 * `gamecube` is intentionally NOT aliased — the theme ships `gamecube.png` and has
 * no `gc.png`, so keeping the id is correct there.
 */
export const SYSTEM_LOGO_ALIAS: Record<string, string> = {
	dos: 'pc',
	o2em: 'odyssey2',
	oricatmos: 'oric',
	thomson: 'to8',
	wswan: 'wonderswan',
	wswanc: 'wonderswancolor',
}

/** Resolve the theme logo basename for an ES system id (identity when no alias). */
export function logoNameForSystem(systemId: string): string {
	return SYSTEM_LOGO_ALIAS[systemId] ?? systemId
}
