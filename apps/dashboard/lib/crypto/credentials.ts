import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { logger } from '@/lib/logger'

const PREFIX = 'enc:v1:'
const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = 'recalbox-credentials-v1'

let warnedNoKey = false

/**
 * Derives the 32-byte encryption key from CREDENTIALS_SECRET (preferred) or
 * BETTER_AUTH_SECRET. Returns null when neither is set — callers then operate
 * in plaintext mode (dev/test). Read fresh each call so tests can vary the env.
 */
function resolveKey(): Buffer | null {
	const secret = process.env.CREDENTIALS_SECRET || process.env.BETTER_AUTH_SECRET
	if (!secret) {
		if (!warnedNoKey) {
			logger.warn(
				'No CREDENTIALS_SECRET/BETTER_AUTH_SECRET set — SSH/IGDB credentials are stored in PLAINTEXT',
			)
			warnedNoKey = true
		}
		return null
	}
	return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), HKDF_INFO, KEY_LEN))
}

export function isEncrypted(value: string): boolean {
	return value.startsWith(PREFIX)
}

/** Encrypts a secret. Empty strings and (no-key mode) pass through unchanged. */
export function encryptSecret(plain: string): string {
	if (plain === '') return plain
	const key = resolveKey()
	if (!key) return plain
	const iv = randomBytes(IV_LEN)
	const cipher = createCipheriv(ALGO, key, iv)
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
	const tag = cipher.getAuthTag()
	return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

/** Decrypts a token. Non-prefixed values are returned unchanged (legacy plaintext). */
export function decryptSecret(value: string): string {
	if (!isEncrypted(value)) return value
	const key = resolveKey()
	if (!key) throw new Error('Encrypted credential present but no decryption key is available')
	const raw = Buffer.from(value.slice(PREFIX.length), 'base64')
	const iv = raw.subarray(0, IV_LEN)
	const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN)
	const ct = raw.subarray(IV_LEN + TAG_LEN)
	const decipher = createDecipheriv(ALGO, key, iv)
	decipher.setAuthTag(tag)
	return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
