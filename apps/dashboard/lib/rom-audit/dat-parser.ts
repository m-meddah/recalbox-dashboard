export type DatRom = {
	name: string
	size: number
	crc?: string
	md5?: string
	sha1?: string
	serial?: string
}

export type DatGame = {
	name: string
	region?: string
	serial?: string
	roms: DatRom[]
}

export type Dat = {
	name: string
	version: string
	games: DatGame[]
}

/**
 * A field value is either quoted or bare — the two dialects of the same format.
 *
 * No-Intro and Redump quote everything: `name "Zelda (Europe).sfc"`. The arcade
 * catalogues quote nothing inside their rom entries: `name 005.zip size 29769`,
 * and their header reads `version 2017-02-14`. Measured on the real MAME.dat, a
 * quote-only reader returned 30 038 games and **zero** roms.
 *
 * The bare alternative stops at the first blank: `(\S+)` and not `(.+)`, or the
 * name would swallow `size` and its value.
 */
const FIELD = (field: string) => new RegExp(`\\b${field}\\s+(?:"([^"]*)"|(\\S+))`)
const ROM_LINE = /^rom\s*\((.*)\)$/

function field(line: string, name: string): string | undefined {
	const m = FIELD(name).exec(line)
	if (!m) return undefined
	// A quoted value may legitimately be empty, so distinguish "" from no match.
	return m[1] !== undefined ? m[1] : m[2]
}

function parseRom(body: string): DatRom | null {
	const name = field(body, 'name')
	if (!name) return null
	const size = /\bsize\s+(\d+)/.exec(body)?.[1]
	const hash = (field: string) =>
		new RegExp(`\\b${field}\\s+([0-9A-Fa-f]+)`).exec(body)?.[1]?.toLowerCase()
	return {
		name,
		size: size ? Number(size) : 0,
		crc: hash('crc'),
		md5: hash('md5'),
		sha1: hash('sha1'),
		serial: field(body, 'serial'),
	}
}

/**
 * Parses the clrmamepro DAT format used by libretro-database.
 *
 * Blocks open on a line ending with `(` and close on a line whose trimmed
 * content is exactly `)`. We rely on that rather than counting parentheses,
 * because game names legitimately contain them — "Super Mario World (Europe)".
 */
export function parseDat(text: string): Dat {
	const dat: Dat = { name: '', version: '', games: [] }
	let block: 'header' | 'game' | null = null
	let current: DatGame | null = null

	for (const raw of text.split('\n')) {
		const line = raw.trim()
		if (!line) continue

		if (line === ')') {
			if (block === 'game' && current) dat.games.push(current)
			block = null
			current = null
			continue
		}

		if (line.startsWith('clrmamepro') && line.endsWith('(')) {
			block = 'header'
			continue
		}

		if (line.startsWith('game') && line.endsWith('(')) {
			block = 'game'
			current = { name: '', roms: [] }
			continue
		}

		if (block === 'header') {
			dat.name = field(line, 'name') ?? dat.name
			dat.version = field(line, 'version') ?? dat.version
			continue
		}

		if (block === 'game' && current) {
			if (line.startsWith('rom')) {
				const romBody = ROM_LINE.exec(line)?.[1]
				if (romBody) {
					const rom = parseRom(romBody)
					if (rom) current.roms.push(rom)
				}
				continue
			}
			// A field belongs to the game only when it opens the line. clrmamepro
			// also has disk/sample/archive entries — standard on the MAME side —
			// whose own `name`/`region`/`serial` would otherwise be read as the
			// game's and overwrite it.
			if (line.startsWith('name ')) current.name = field(line, 'name') ?? current.name
			if (line.startsWith('region ')) current.region = field(line, 'region') ?? current.region
			if (line.startsWith('serial ')) current.serial = field(line, 'serial') ?? current.serial
		}
	}

	return dat
}
