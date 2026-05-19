import type { MultiDiscGame } from './multidisc-detector'

export function generateM3uContent(game: MultiDiscGame): string {
	return game.discs.map((d) => d.fileName).join('\n') + '\n'
}

export function sanitizeM3uFileName(baseName: string): string {
	return (
		baseName
			.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
			.replace(/\s+/g, ' ')
			.trim() + '.m3u'
	)
}
