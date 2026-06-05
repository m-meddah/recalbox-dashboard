import type { MultiDiscGame } from './multidisc-detector'

export function generateM3uContent(game: MultiDiscGame): string {
	return `${game.discs.map((d) => d.fileName).join('\n')}\n`
}

export function sanitizeM3uFileName(baseName: string): string {
	return `${baseName
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — strip control chars from filenames
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()}.m3u`
}
