import { describe, expect, it } from 'vitest'
import { parseTrustedOrigins } from '../trusted-origins'

describe('parseTrustedOrigins', () => {
	it('splits a comma-separated list into trimmed origins', () => {
		expect(
			parseTrustedOrigins({
				BETTER_AUTH_TRUSTED_ORIGINS: 'https://a.ts.net,https://b.ts.net',
			} as unknown as NodeJS.ProcessEnv),
		).toEqual(['https://a.ts.net', 'https://b.ts.net'])
	})

	it('trims spaces and drops empty entries', () => {
		expect(
			parseTrustedOrigins({
				BETTER_AUTH_TRUSTED_ORIGINS: ' https://a.ts.net , , https://b.ts.net ,',
			} as unknown as NodeJS.ProcessEnv),
		).toEqual(['https://a.ts.net', 'https://b.ts.net'])
	})

	it('falls back to BETTER_AUTH_URL when the CSV is unset', () => {
		expect(
			parseTrustedOrigins({
				BETTER_AUTH_URL: 'https://host.ts.net',
			} as unknown as NodeJS.ProcessEnv),
		).toEqual(['https://host.ts.net'])
	})

	it('returns an empty array when neither is set', () => {
		expect(parseTrustedOrigins({} as NodeJS.ProcessEnv)).toEqual([])
	})
})
