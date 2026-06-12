/**
 * Surgical editor for a single `<game>` entry's emulator/core override inside a
 * Recalbox `gamelist.xml`. We deliberately avoid a full XML re-serialization:
 * only the matched `<game>` block is rewritten, every other byte of the file is
 * left untouched. This keeps the blast radius to one game and never risks
 * mangling the rest of the user's collection metadata.
 *
 * EmulationStation owns this file and re-canonicalizes it on its next save, so
 * cosmetic formatting is irrelevant — correctness and minimal disturbance are
 * what matter here.
 */

export class GameNotFoundError extends Error {
	constructor(public readonly relativeRomPath: string) {
		super(`No <game> with path "${relativeRomPath}" in gamelist`)
		this.name = 'GameNotFoundError'
	}
}

// Matches a full `<game …>…</game>` block (not `<folder>`). Non-greedy body.
const GAME_BLOCK_RE = /<game\b[^>]*>[\s\S]*?<\/game>/g
const CHILD_INDENT = '\t\t'

function xmlEscape(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Recalbox stores paths as `./rel` or `rel`; normalize for comparison. */
function normalizePath(p: string): string {
	return p.replace(/^\.\//, '').trim()
}

function extractPath(block: string): string | null {
	const value = block.match(/<path>([\s\S]*?)<\/path>/)?.[1]
	return value != null ? value.trim() : null
}

/** Remove a `<tag>…</tag>` child line entirely, including its indent + newline. */
function removeChild(block: string, tag: string): string {
	const re = new RegExp(`[\\t ]*<${tag}>[\\s\\S]*?</${tag}>[\\t ]*\\n?`, 'g')
	return block.replace(re, '')
}

/**
 * Return a new gamelist XML where the game matching `relativeRomPath` has its
 * `<emulator>`/`<core>` set to the given values. Passing `null`/empty for both
 * removes any existing override (reset to the system default).
 *
 * @throws GameNotFoundError when no `<game>` matches the path.
 */
export function setGameEmulatorOverride(
	xml: string,
	relativeRomPath: string,
	emulator: string | null,
	core: string | null,
): string {
	const target = normalizePath(relativeRomPath)
	let found = false

	const out = xml.replace(GAME_BLOCK_RE, (block) => {
		const path = extractPath(block)
		if (!path || normalizePath(path) !== target) return block
		found = true

		// Always strip existing overrides first, then re-add the new ones.
		let next = removeChild(block, 'emulator')
		next = removeChild(next, 'core')

		const inserts: string[] = []
		if (emulator?.trim()) {
			inserts.push(`${CHILD_INDENT}<emulator>${xmlEscape(emulator.trim())}</emulator>`)
		}
		if (core?.trim()) {
			inserts.push(`${CHILD_INDENT}<core>${xmlEscape(core.trim())}</core>`)
		}
		if (inserts.length === 0) return next // reset — nothing to insert

		// Insert just before the block's closing </game> (its own indented line).
		return next.replace(/(\n[\t ]*<\/game>)/, `\n${inserts.join('\n')}$1`)
	})

	if (!found) throw new GameNotFoundError(relativeRomPath)
	return out
}
