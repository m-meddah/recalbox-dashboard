import type { MultiDiscGame } from './multidisc-detector'

const BOM = '\uFEFF'

export function generateM3uContent(game: MultiDiscGame): string {
	return `${game.discs.map((d) => d.fileName).join('\n')}\n`
}

/**
 * Rewrite an existing .m3u to the only shape Dolphin accepts: UTF-8 with no BOM,
 * LF line endings, no trailing whitespace, one trailing LF.
 *
 * Content-preserving on purpose — hand-added lines (bonus discs, special discs)
 * survive, unlike a regeneration from the detected disc list.
 */
export function normalizeM3uContent(raw: string): string {
	const lines = raw
		.replace(/^\uFEFF/, '')
		.split(/\r\n|\r|\n/)
		.map((line) => line.trim())
		.filter(Boolean)
	return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

/** True when the file would change under {@link normalizeM3uContent}. */
export function m3uNeedsRepair(raw: string): boolean {
	return raw.startsWith(BOM) || raw.includes('\r') || normalizeM3uContent(raw) !== raw
}

export function sanitizeM3uFileName(baseName: string): string {
	return `${baseName
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — strip control chars from filenames
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()}.m3u`
}
