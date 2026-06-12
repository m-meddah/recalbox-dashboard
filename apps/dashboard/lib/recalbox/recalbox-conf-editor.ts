/**
 * Minimal, line-preserving editor for Recalbox's `recalbox.conf` (a flat
 * `key=value` file with `#` comments). Used to set per-system overrides that
 * the Web Manager API refuses (e.g. `snes.emulator`) but the box honors at
 * launch time. Only the targeted keys are touched; every other line — comments
 * included — is left exactly as-is.
 */

export const RECALBOX_CONF_PATH = '/recalbox/share/system/recalbox.conf'

/** True for an uncommented `key=...` line (ignoring leading whitespace). */
function lineSetsKey(line: string, key: string): boolean {
	const trimmed = line.trim()
	if (!trimmed || trimmed.startsWith('#')) return false
	const eq = trimmed.indexOf('=')
	return eq !== -1 && trimmed.slice(0, eq).trim() === key
}

function lineValue(line: string): string {
	const eq = line.indexOf('=')
	return eq === -1 ? '' : line.slice(eq + 1).trim()
}

/** Read the values of the given keys (null when absent or commented out). */
export function parseConfValues(content: string, keys: string[]): Record<string, string | null> {
	const out: Record<string, string | null> = {}
	for (const key of keys) out[key] = null
	for (const line of content.split('\n')) {
		for (const key of keys) {
			if (lineSetsKey(line, key)) out[key] = lineValue(line)
		}
	}
	return out
}

/** Collect every uncommented key ending in `suffix` → its value, e.g. `.emulator`. */
export function extractConfKeysBySuffix(content: string, suffix: string): Record<string, string> {
	const out: Record<string, string> = {}
	for (const line of content.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq === -1) continue
		const key = trimmed.slice(0, eq).trim()
		if (key.endsWith(suffix)) out[key] = trimmed.slice(eq + 1).trim()
	}
	return out
}

/**
 * Return new file content with each key set to its value, or removed when the
 * value is `null`. An existing uncommented line is replaced in place; a new key
 * is appended at the end. Commented lines and unrelated keys are preserved.
 */
export function setConfValues(content: string, changes: Record<string, string | null>): string {
	const eol = content.includes('\r\n') ? '\r\n' : '\n'
	const lines = content.split(/\r?\n/)
	const handled = new Set<string>()

	const result: string[] = []
	for (const line of lines) {
		const target = Object.keys(changes).find((k) => lineSetsKey(line, k))
		if (!target) {
			result.push(line)
			continue
		}
		const value = changes[target]
		handled.add(target)
		if (value === null) continue // drop the line (reset to default)
		// Replace only the first occurrence; skip any later duplicates of the key.
		if (!result.some((l) => lineSetsKey(l, target))) result.push(`${target}=${value}`)
	}

	// Append keys that didn't exist yet (and aren't being removed).
	const appends = Object.entries(changes).filter(([k, v]) => !handled.has(k) && v !== null)
	if (appends.length > 0) {
		// Keep a single trailing newline: drop a trailing empty element if present.
		while (result.length > 0 && result[result.length - 1] === '') result.pop()
		for (const [k, v] of appends) result.push(`${k}=${v}`)
		result.push('')
	}

	return result.join(eol)
}
