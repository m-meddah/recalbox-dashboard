/**
 * Metadata layer over the uniform Web Manager configuration API. The wire
 * format carries no labels, enum options or sensitivity flags, so this module
 * supplies them. It stays deliberately light: rendering is generic (type is
 * inferred from the value) and human labels fall back to {@link humanizeKey},
 * with optional i18n overrides under `config.fields.<key>`.
 */

export type ConfigSectionId =
	| 'global'
	| 'system'
	| 'audio'
	| 'scraper'
	| 'updates'
	| 'controllers'
	| 'hyperion'
	| 'kodi'
	| 'wifi'

export type ConfigSectionMeta = {
	id: ConfigSectionId
	/** Sensitive sections (network/system) require an explicit confirm before save. */
	risky?: boolean
	/** Many of these settings only take effect after an EmulationStation restart. */
	requiresEsRestart?: boolean
}

/** Sections surfaced in the dashboard navigation, in display order. */
export const CONFIG_SECTIONS: ConfigSectionMeta[] = [
	{ id: 'global', requiresEsRestart: true },
	{ id: 'system', risky: true, requiresEsRestart: true },
	{ id: 'audio' },
	{ id: 'scraper' },
	{ id: 'controllers', requiresEsRestart: true },
	{ id: 'updates' },
	{ id: 'hyperion' },
	{ id: 'kodi' },
	{ id: 'wifi', risky: true },
]

/**
 * Every section the configuration API accepts — used to validate route params.
 * Superset of {@link CONFIG_SECTIONS} (some are reachable but not in the nav).
 */
export const KNOWN_API_SECTIONS = new Set<string>([
	'global',
	'system',
	'audio',
	'controllers',
	'emulationstation',
	'frontend',
	'hat',
	'hyperion',
	'kodi',
	'lircd',
	'music',
	'patron',
	'scraper',
	'tate',
	'updates',
	'wifi',
	'wifi2',
	'wifi3',
	'autorun',
])

const RISKY_SECTION_IDS = new Set<string>()
for (const s of CONFIG_SECTIONS) {
	if (s.risky) RISKY_SECTION_IDS.add(s.id)
}

export function isKnownApiSection(section: string): boolean {
	return KNOWN_API_SECTIONS.has(section)
}

export function isRiskySection(section: string): boolean {
	return RISKY_SECTION_IDS.has(section) || section.startsWith('wifi')
}

/**
 * Secret keys: their value is never returned to the browser and never logged.
 * Covers passwords, private keys, API keys and the Wi-Fi pre-shared key.
 */
export function isSecretKey(key: string): boolean {
	const k = key.toLowerCase()
	return (
		k.endsWith('password') || k.endsWith('privatekey') || k.endsWith('apikey') || k === 'key' // wifi pre-shared key
	)
}

/** Fallback human label from a dotted config key, e.g. `netplay.nickname` -> `Netplay nickname`. */
export function humanizeKey(key: string): string {
	const words = key
		.replace(/[._-]+/g, ' ')
		.trim()
		.split(/\s+/)
	return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
}
