import { describe, expect, it } from 'vitest'
import { GameNotFoundError, setGameEmulatorOverride } from '../gamelist-writer'

const XML = `<?xml version="1.0"?>
<gameList>
	<folder source="Recalbox" timestamp="0">
		<name>A</name>
		<path>A</path>
	</folder>
	<game source="Recalbox" timestamp="1">
		<name>Super Mario World</name>
		<path>./Super Mario World (USA).sfc</path>
		<rating>0.95</rating>
	</game>
	<game source="Recalbox" timestamp="2">
		<name>Zelda</name>
		<path>Zelda (USA).sfc</path>
		<emulator>libretro</emulator>
		<core>snes9x</core>
		<rating>0.9</rating>
	</game>
</gameList>
`

function gameBlock(xml: string, name: string): string {
	const blocks = xml.match(/<game\b[^>]*>[\s\S]*?<\/game>/g) ?? []
	return blocks.find((b) => b.includes(`<name>${name}</name>`)) ?? ''
}

describe('setGameEmulatorOverride', () => {
	it('adds emulator/core to a game that had none', () => {
		const out = setGameEmulatorOverride(
			XML,
			'Super Mario World (USA).sfc',
			'libretro',
			'snes9x2010',
		)
		const block = gameBlock(out, 'Super Mario World')
		expect(block).toContain('<emulator>libretro</emulator>')
		expect(block).toContain('<core>snes9x2010</core>')
		// untouched fields preserved
		expect(block).toContain('<rating>0.95</rating>')
	})

	it('matches regardless of a leading ./ in either side', () => {
		// stored path has ./, query without
		const out = setGameEmulatorOverride(
			XML,
			'Super Mario World (USA).sfc',
			'mednafen',
			'mednafen_snes',
		)
		expect(gameBlock(out, 'Super Mario World')).toContain('<core>mednafen_snes</core>')
	})

	it('replaces an existing override without duplicating tags', () => {
		const out = setGameEmulatorOverride(XML, 'Zelda (USA).sfc', 'libretro', 'bsnes')
		const block = gameBlock(out, 'Zelda')
		expect(block).toContain('<core>bsnes</core>')
		expect(block).not.toContain('snes9x')
		expect(block.match(/<emulator>/g)).toHaveLength(1)
		expect(block.match(/<core>/g)).toHaveLength(1)
	})

	it('removes the override when both values are null (reset)', () => {
		const out = setGameEmulatorOverride(XML, 'Zelda (USA).sfc', null, null)
		const block = gameBlock(out, 'Zelda')
		expect(block).not.toContain('<emulator>')
		expect(block).not.toContain('<core>')
		expect(block).toContain('<rating>0.9</rating>')
	})

	it('leaves other games and folders untouched', () => {
		const out = setGameEmulatorOverride(XML, 'Super Mario World (USA).sfc', 'libretro', 'snes9x')
		// Zelda block unchanged
		expect(gameBlock(out, 'Zelda')).toBe(gameBlock(XML, 'Zelda'))
		expect(out).toContain('<folder source="Recalbox" timestamp="0">')
	})

	it('escapes XML-special characters in values', () => {
		const out = setGameEmulatorOverride(XML, 'Super Mario World (USA).sfc', 'a&b', 'c<d')
		const block = gameBlock(out, 'Super Mario World')
		expect(block).toContain('<emulator>a&amp;b</emulator>')
		expect(block).toContain('<core>c&lt;d</core>')
	})

	it('throws GameNotFoundError when no game matches', () => {
		expect(() => setGameEmulatorOverride(XML, 'Missing.sfc', 'libretro', 'snes9x')).toThrow(
			GameNotFoundError,
		)
	})
})
