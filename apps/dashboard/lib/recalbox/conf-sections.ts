/**
 * Field specs for the recalbox.conf "sections" surfaced by the dashboard.
 * Imported by both the API routes (validation) and the pages (rendering),
 * keeping the key list and types in one place.
 */

import type { FieldSpec } from './conf-section'

// Single-line free text: anything but newlines/carriage returns.
const SINGLE_LINE = /^[^\n\r]*$/
// A http(s) URL without whitespace.
const URL_RE = /^https?:\/\/\S*$/

/** Parental control — hide adult-rated games in EmulationStation. */
export const PARENTAL_SPECS: readonly FieldSpec[] = [
	{ key: 'emulationstation.filteradultgames', type: 'boolean' },
]

/** RetroArch netplay (online play). */
export const NETPLAY_SPECS: readonly FieldSpec[] = [
	{ key: 'global.netplay', type: 'boolean' },
	{ key: 'global.netplay.nickname', type: 'string', pattern: SINGLE_LINE, maxLen: 32 },
	{ key: 'global.netplay.port', type: 'int', min: 1024, max: 65535 },
	{ key: 'global.netplay.lobby', type: 'string', pattern: URL_RE, maxLen: 200 },
]

/** Arcade metasystem + virtual collections (EmulationStation navigation). */
export const ES_COLLECTIONS_SPECS: readonly FieldSpec[] = [
	{ key: 'emulationstation.arcade', type: 'boolean' },
	{ key: 'emulationstation.arcade.includeneogeo', type: 'boolean' },
	{ key: 'emulationstation.arcade.hideoriginals', type: 'boolean' },
	{ key: 'emulationstation.collection.allgames', type: 'boolean' },
	{ key: 'emulationstation.collection.multiplayers', type: 'boolean' },
	{ key: 'emulationstation.collection.lastplayed', type: 'boolean' },
]

export const SHADERSET_OPTIONS = ['none', 'retro', 'scanlines', 'crtcurved'] as const
export const RATIO_OPTIONS = ['auto', '4/3', '16/9', '16/10', 'custom'] as const

/** Global video/emulation defaults. */
export const VIDEO_SPECS: readonly FieldSpec[] = [
	{ key: 'global.shaderset', type: 'enum', options: SHADERSET_OPTIONS },
	{ key: 'global.ratio', type: 'enum', options: RATIO_OPTIONS },
	{ key: 'global.smooth', type: 'boolean' },
	{ key: 'global.integerscale', type: 'boolean' },
	{ key: 'global.rewind', type: 'boolean' },
	{ key: 'global.autosave', type: 'boolean' },
]
