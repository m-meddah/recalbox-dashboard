// apps/dashboard/lib/crypto/__tests__/credentials.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const KEY = 'test-secret-at-least-32-chars-long-aaaa'

describe('credentials crypto', () => {
	beforeEach(() => {
		process.env.BETTER_AUTH_SECRET = KEY
		// biome-ignore lint/performance/noDelete: env var must be truly absent, not set to "undefined"
		delete process.env.CREDENTIALS_SECRET
	})
	afterEach(() => {
		// biome-ignore lint/performance/noDelete: env var must be truly absent, not set to "undefined"
		delete process.env.BETTER_AUTH_SECRET
		// biome-ignore lint/performance/noDelete: env var must be truly absent, not set to "undefined"
		delete process.env.CREDENTIALS_SECRET
	})

	it('round-trips a secret', async () => {
		const { encryptSecret, decryptSecret, isEncrypted } = await import('../credentials')
		const token = encryptSecret('hunter2')
		expect(isEncrypted(token)).toBe(true)
		expect(token).not.toContain('hunter2')
		expect(decryptSecret(token)).toBe('hunter2')
	})

	it('produces a different ciphertext each call (random IV)', async () => {
		const { encryptSecret } = await import('../credentials')
		expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
	})

	it('passes plaintext through on decrypt (backward compat)', async () => {
		const { decryptSecret } = await import('../credentials')
		expect(decryptSecret('legacy-plaintext')).toBe('legacy-plaintext')
	})

	it('never encrypts empty string', async () => {
		const { encryptSecret, isEncrypted } = await import('../credentials')
		const out = encryptSecret('')
		expect(out).toBe('')
		expect(isEncrypted(out)).toBe(false)
	})

	it('prefers CREDENTIALS_SECRET over BETTER_AUTH_SECRET', async () => {
		const { encryptSecret, decryptSecret } = await import('../credentials')
		const token = encryptSecret('x')
		process.env.CREDENTIALS_SECRET = 'a-completely-different-dedicated-key-value'
		// A different key must fail to authenticate the GCM tag.
		expect(() => decryptSecret(token)).toThrow()
	})

	it('throws on tampered ciphertext', async () => {
		const { encryptSecret, decryptSecret } = await import('../credentials')
		const token = encryptSecret('secret')
		const tampered = `${token.slice(0, -2)}AA`
		expect(() => decryptSecret(tampered)).toThrow()
	})

	it('with no key: encrypt returns plaintext, decrypt passes through', async () => {
		// biome-ignore lint/performance/noDelete: env var must be truly absent, not set to "undefined"
		delete process.env.BETTER_AUTH_SECRET
		// biome-ignore lint/performance/noDelete: env var must be truly absent, not set to "undefined"
		delete process.env.CREDENTIALS_SECRET
		const { encryptSecret, decryptSecret, isEncrypted } = await import('../credentials')
		const out = encryptSecret('plain')
		expect(out).toBe('plain')
		expect(isEncrypted(out)).toBe(false)
		expect(decryptSecret('plain')).toBe('plain')
	})
})
