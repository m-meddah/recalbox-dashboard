import { logger } from '@/lib/logger'
import { shellQuote } from './shell'
import type { SshClientLike } from './ssh-client'

export type PatronStatus = {
	/** True if the user has a Patron key configured and it looks valid. */
	isPatron: boolean
	/** True if the key is present in recalbox.conf and non-empty. */
	keyPresent: boolean
	/** True if the key passes a basic format sanity check (no network call). */
	keyLooksValid: boolean
}

const PATRON_KEY = 'patron.privatekey'
const CONF_PATH = '/recalbox/share/system/recalbox.conf'

/**
 * The grep pattern, built here so it can be passed as ONE shell-quoted argument.
 *
 * Interpolating shellQuote() inside an already-open '…' — as this did — quotes
 * nothing: its own quotes close and reopen the surrounding ones, leaving the value
 * in an UNQUOTED context. It happened to work only because the key is a constant
 * with no shell metacharacters. See the note in conf-reader.ts, where the same
 * shape was reachable from user input.
 *
 * The dot is escaped so it matches a literal '.', not any character; parsePresence
 * re-checks the key exactly, so this only tightens the pre-filter.
 */
const PATRON_KEY_PATTERN = `^\\s*${PATRON_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`

// Patron keys appear to be base64url-encoded strings (≥ 16 chars).
// This is a format sanity check only — not a server-side validation.
function looksValid(value: string): boolean {
	return value.length >= 16 && /^[A-Za-z0-9+/=_\-]+$/.test(value)
}

function parsePresence(output: string): { present: boolean; looksValid: boolean } {
	for (const line of output.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eqIdx = trimmed.indexOf('=')
		if (eqIdx === -1) continue
		const k = trimmed.slice(0, eqIdx).trim()
		if (k !== PATRON_KEY) continue
		const value = trimmed.slice(eqIdx + 1).trim()
		// Value intentionally not stored or returned — only used for presence checks.
		const present = value.length > 0
		return { present, looksValid: present && looksValid(value) }
	}
	return { present: false, looksValid: false }
}

export async function getPatronStatus(ssh: SshClientLike): Promise<PatronStatus> {
	try {
		// grep rather than cat: the value is a secret, and this keeps it from crossing
		// the SSH channel at all beyond the single matching line.
		const output = await ssh.exec(
			`grep -E ${shellQuote(PATRON_KEY_PATTERN)} ${shellQuote(CONF_PATH)} || true`,
		)
		const { present, looksValid: valid } = parsePresence(output)
		return { isPatron: present && valid, keyPresent: present, keyLooksValid: valid }
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		logger.warn(`Failed to read patron status from recalbox.conf: ${msg}`)
		return { isPatron: false, keyPresent: false, keyLooksValid: false }
	}
}

/** Exported for testing only. */
export { parsePresence as _parsePresence }
