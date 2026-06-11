import { describe, expect, it } from 'vitest'
import { generateInvitationToken, hashInvitationToken } from '../invitation-token'

describe('invitation-token', () => {
	it('generateInvitationToken returns a url-safe token and its sha256 hash', () => {
		const { token, tokenHash } = generateInvitationToken()
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(token.length).toBeGreaterThanOrEqual(40)
		expect(tokenHash).toBe(hashInvitationToken(token))
		expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
	})

	it('generates a distinct token each call', () => {
		const a = generateInvitationToken()
		const b = generateInvitationToken()
		expect(a.token).not.toBe(b.token)
		expect(a.tokenHash).not.toBe(b.tokenHash)
	})

	it('hashInvitationToken is deterministic', () => {
		expect(hashInvitationToken('abc')).toBe(hashInvitationToken('abc'))
		expect(hashInvitationToken('abc')).not.toBe(hashInvitationToken('abd'))
	})
})
