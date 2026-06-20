import type { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { getBearerToken } from '../bearer'

function req(auth?: string): NextRequest {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (auth ?? null) : null) },
	} as unknown as NextRequest
}

describe('getBearerToken', () => {
	it('extracts the token from a Bearer header', () => {
		expect(getBearerToken(req('Bearer sra_abc'))).toBe('sra_abc')
	})
	it('is case-insensitive on the scheme', () => {
		expect(getBearerToken(req('bearer sra_abc'))).toBe('sra_abc')
	})
	it('returns null without a header', () => {
		expect(getBearerToken(req())).toBeNull()
	})
	it('returns null for a non-Bearer scheme', () => {
		expect(getBearerToken(req('Basic xyz'))).toBeNull()
	})
})
