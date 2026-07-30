import { SYSTEM_META } from '@/lib/recalbox/system-meta'

export type SystemCatalog = {
	/** Also the directory name under `metadat/` — hence 'fbneo-split', not 'fbneo'. */
	source: 'no-intro' | 'redump' | 'mame' | 'fbneo-split'
	file: string
	/** 'content' hashes the ROM inside the archive; 'container' hashes the archive. */
	hashMode: 'content' | 'container'
	ssConsoleId?: number
}

/** The reference catalogue for a Recalbox system id, or null when it has none. */
export function catalogForSystem(id: string): SystemCatalog | null {
	const meta = SYSTEM_META[id]
	if (!meta?.datSource || !meta.datFile) return null
	return {
		source: meta.datSource,
		file: meta.datFile,
		hashMode: meta.hashMode ?? 'content',
		ssConsoleId: meta.ssConsoleId,
	}
}
