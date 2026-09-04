import { getAgentVersion } from '@/lib/agent/bearer'
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

function versionReq(value: string | null) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'x-agent-version' ? value : null) },
	} as never
}

describe('getAgentVersion', () => {
	it('reads a dotted numeric version', () => {
		expect(getAgentVersion(versionReq('1.1.0'))).toBe('1.1.0')
	})

	it('trims surrounding whitespace', () => {
		expect(getAgentVersion(versionReq('  1.1.0\n'))).toBe('1.1.0')
	})

	it('returns null when the header is absent or empty', () => {
		expect(getAgentVersion(versionReq(null))).toBeNull()
		expect(getAgentVersion(versionReq('   '))).toBeNull()
	})

	it('rejects anything that is not a dotted number', () => {
		// This string reaches the database and a version comparison; an agent is
		// free to send anything, so the shape is checked before it lands.
		expect(getAgentVersion(versionReq('1.1.0; DROP TABLE'))).toBeNull()
		expect(getAgentVersion(versionReq('latest'))).toBeNull()
		expect(getAgentVersion(versionReq('1.'.repeat(200)))).toBeNull()
	})
})
