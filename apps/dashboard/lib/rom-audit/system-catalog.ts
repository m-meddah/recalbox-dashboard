import { SYSTEM_META } from '@/lib/recalbox/system-meta'

export type SystemCatalog = {
	source: 'no-intro' | 'redump' | 'mame'
	file: string
	ssConsoleId?: number
}

/** The reference catalogue for a Recalbox system id, or null when it has none. */
export function catalogForSystem(id: string): SystemCatalog | null {
	const meta = SYSTEM_META[id]
	if (!meta?.datSource || !meta.datFile) return null
	return { source: meta.datSource, file: meta.datFile, ssConsoleId: meta.ssConsoleId }
}
