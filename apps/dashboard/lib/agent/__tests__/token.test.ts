import { describe, expect, it } from 'vitest'
import { generateAgentToken, hashAgentToken } from '../token'

describe('agent token', () => {
	it('hashAgentToken is a deterministic 64-char sha256 hex', () => {
		const h1 = hashAgentToken('sra_abc')
		const h2 = hashAgentToken('sra_abc')
		expect(h1).toBe(h2)
		expect(h1).toMatch(/^[0-9a-f]{64}$/)
		expect(hashAgentToken('sra_def')).not.toBe(h1)
	})

	it('generateAgentToken returns a prefixed token whose hash matches', () => {
		const { token, tokenHash } = generateAgentToken()
		expect(token.startsWith('sra_')).toBe(true)
		expect(tokenHash).toBe(hashAgentToken(token))
		expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
	})

	it('generates a unique token on each call', () => {
		const a = generateAgentToken()
		const b = generateAgentToken()
		expect(a.token).not.toBe(b.token)
		expect(a.tokenHash).not.toBe(b.tokenHash)
	})
})
