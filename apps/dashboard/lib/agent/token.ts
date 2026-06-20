import { createHash, randomBytes } from 'node:crypto'

/** SHA-256 hex of a raw agent token. Only the hash is ever persisted. */
export function hashAgentToken(token: string): string {
	return createHash('sha256').update(token).digest('hex')
}

/**
 * A 256-bit url-safe agent token plus its hash. The `sra_` prefix makes the
 * token recognisable in logs and secret scanners. The raw token is shown once
 * at creation and never stored — only its hash goes to the database.
 */
export function generateAgentToken(): { token: string; tokenHash: string } {
	const token = `sra_${randomBytes(32).toString('base64url')}`
	return { token, tokenHash: hashAgentToken(token) }
}
