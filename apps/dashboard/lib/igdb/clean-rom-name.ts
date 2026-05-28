export function cleanRomName(romName: string): string {
	let name = romName

	// File extensions (including GameCube/Wii formats)
	name = name.replace(
		/\.(zip|7z|rar|sfc|smc|nes|gba|gbc|gb|md|smd|gen|iso|chd|cue|bin|rom|n64|z64|v64|rvz|wbfs|wad|gcm|gcz|cso|pbp|nds|3ds|cia)$/i,
		'',
	)

	// Regions in parentheses
	name = name.replace(
		/\((USA|Europe|Japan|World|UE|JU|JE|EU|U|J|E|En|Fr|De|Es|It|Pt|Nl|Sv|No|Da|Fi|Pl|Ru|Ko|Zh|Asia|Australia|Brazil|Korea|China|Taiwan|Hong Kong|Spain|France|Germany|Italy|Netherlands|Sweden|Norway|Denmark|Finland|Poland|Russia|Korean|Chinese)(,\s*(USA|Europe|Japan|World|UE|JU|JE|EU|U|J|E|En|Fr|De|Es|It|Pt|Nl|Sv|No|Da|Fi|Pl|Ru|Ko|Zh|Asia|Australia|Brazil|Korea|China|Taiwan|Hong Kong))*\)/gi,
		'',
	)

	// Versions / revisions / states
	name = name.replace(/\(Rev[\s.]?[A-Z0-9]+\)/gi, '')
	name = name.replace(/\(v[\d.]+\)/gi, '')
	name = name.replace(/\((Beta|Proto|Alpha|Demo|Sample)[\s\d]*\)/gi, '')
	name = name.replace(/\((Unl|Pirate)\)/gi, '')

	// Square bracket tags
	name = name.replace(/\[[^\]]*\]/g, '')

	// Remaining parentheses
	name = name.replace(/\([^)]*\)/g, '')

	// Dash separators
	name = name.replace(/\s+-\s+/g, ' ')

	// Apostrophes and special chars
	name = name.replace(/['']s\b/g, 's')
	name = name.replace(/['"`´]/g, '')

	return name.replace(/\s+/g, ' ').trim()
}

export function generateNameVariants(romName: string): string[] {
	const cleaned = cleanRomName(romName)
	const variants = new Set<string>([cleaned])

	variants.add(removeAccents(cleaned))
	variants.add(convertRomanToArabic(cleaned))
	variants.add(convertArabicToRoman(cleaned))

	if (cleaned.includes(':')) {
		const beforeColon = cleaned.split(':')[0]
		if (beforeColon) variants.add(beforeColon.trim())
	}

	return Array.from(variants).filter((v) => v.length >= 2)
}

function removeAccents(s: string): string {
	return s.normalize('NFD').replace(/\p{M}/gu, '')
}

const ROMAN_TO_ARABIC: [string, string][] = [
	[' VIII', ' 8'],
	[' VII', ' 7'],
	[' III', ' 3'],
	[' II', ' 2'],
	[' IV', ' 4'],
	[' VI', ' 6'],
	[' IX', ' 9'],
	[' V', ' 5'],
	[' X', ' 10'],
]

const ARABIC_TO_ROMAN: [string, string][] = [
	[' 2', ' II'],
	[' 3', ' III'],
	[' 4', ' IV'],
	[' 5', ' V'],
	[' 6', ' VI'],
	[' 7', ' VII'],
	[' 8', ' VIII'],
	[' 9', ' IX'],
	[' 10', ' X'],
]

function convertRomanToArabic(s: string): string {
	let r = s
	for (const [roman, arabic] of ROMAN_TO_ARABIC) {
		r = r.replace(new RegExp(`${roman}\\b`, 'g'), arabic)
	}
	return r
}

function convertArabicToRoman(s: string): string {
	let r = s
	for (const [arabic, roman] of ARABIC_TO_ROMAN) {
		r = r.replace(new RegExp(`${arabic}\\b`, 'g'), roman)
	}
	return r
}
