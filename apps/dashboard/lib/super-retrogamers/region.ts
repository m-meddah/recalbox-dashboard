const REGION_TAGS: Array<[RegExp, string]> = [
	[/\(USA\)/i, 'US'],
	[/\(U\)/, 'US'],
	[/\(Europe\)/i, 'EU'],
	[/\(E\)/, 'EU'],
	[/\(Japan\)/i, 'JP'],
	[/\(J\)/, 'JP'],
	[/\(Australia\)/i, 'AU'],
	[/\(Korea\)/i, 'KR'],
	[/\(China\)/i, 'CN'],
	[/\(Brazil\)/i, 'BR'],
	[/\(World\)/i, 'US'],
]

export function regionFromRomName(romName: string): string | null {
	for (const [pattern, region] of REGION_TAGS) {
		if (pattern.test(romName)) return region
	}
	return null
}

export function resolveRegion(romName: string, preferredRegion: string): string | null {
	return regionFromRomName(romName) ?? (preferredRegion || null)
}
