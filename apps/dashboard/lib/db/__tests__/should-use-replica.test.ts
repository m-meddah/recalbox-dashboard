import { describe, expect, it } from 'vitest'
import { shouldUseReplica } from '../should-use-replica'

const TURSO = { TURSO_DATABASE_URL: 'libsql://example.turso.io' }
const WEB_ARGV = ['node', 'server.js']

describe('shouldUseReplica', () => {
	it('is false when no Turso URL is configured (pure-local SQLite)', () => {
		expect(shouldUseReplica({}, WEB_ARGV)).toBe(false)
	})

	it('is false for the scrobbler process (write-mostly, avoids replica file collision)', () => {
		expect(shouldUseReplica(TURSO, ['node', 'scrobbler.js'])).toBe(false)
	})

	it('is false for one-shot scripts under scripts/', () => {
		expect(shouldUseReplica(TURSO, ['node', 'scripts/create-agent-token.ts'])).toBe(false)
	})

	describe('on Vercel — replica is opt-IN (the Fluid CPU / cold-start re-sync footgun)', () => {
		it('is OFF by default even with Turso configured', () => {
			expect(shouldUseReplica({ ...TURSO, VERCEL: '1' }, WEB_ARGV)).toBe(false)
		})

		it('stays OFF when only the self-hosted disable flag is fiddled with', () => {
			expect(
				shouldUseReplica({ ...TURSO, VERCEL: '1', TURSO_DISABLE_REPLICA: '0' }, WEB_ARGV),
			).toBe(false)
		})

		it('is ON only with the explicit opt-in TURSO_ENABLE_REPLICA=1', () => {
			expect(shouldUseReplica({ ...TURSO, VERCEL: '1', TURSO_ENABLE_REPLICA: '1' }, WEB_ARGV)).toBe(
				true,
			)
		})
	})

	describe('self-hosted / local — replica is opt-OUT (fast local reads by default)', () => {
		it('is ON by default', () => {
			expect(shouldUseReplica(TURSO, WEB_ARGV)).toBe(true)
		})

		it('is OFF when explicitly disabled', () => {
			expect(shouldUseReplica({ ...TURSO, TURSO_DISABLE_REPLICA: '1' }, WEB_ARGV)).toBe(false)
		})
	})
})
