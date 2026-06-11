import { createHash, randomBytes } from 'node:crypto'

/** SHA-256 hex of a raw invitation token. Only the hash is ever persisted. */
export function hashInvitationToken(token: string): string {
	return createHash('sha256').update(token).digest('hex')
}

/** A 256-bit url-safe token plus its hash. The raw token is shown once, never stored. */
export function generateInvitationToken(): { token: string; tokenHash: string } {
	const token = randomBytes(32).toString('base64url')
	return { token, tokenHash: hashInvitationToken(token) }
}
