import { describe, expect, it } from 'vitest'
import { buildRateLimitConfig } from '../rate-limit'

describe('buildRateLimitConfig', () => {
	it('is enabled in production', () => {
		const cfg = buildRateLimitConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
		expect(cfg?.enabled).toBe(true)
	})

	it('is disabled outside production', () => {
		expect(buildRateLimitConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)?.enabled).toBe(
			false,
		)
		expect(buildRateLimitConfig({} as NodeJS.ProcessEnv)?.enabled).toBe(false)
	})

	it('applies a strict rule to the email sign-in path', () => {
		const cfg = buildRateLimitConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
		expect(cfg?.customRules?.['/sign-in/email']).toEqual({ window: 60, max: 5 })
	})

	it('counts in the database, not per process', () => {
		// The in-memory store tallies per instance, so on Vercel the real ceiling is
		// 5 × (live instances). Only a shared store makes the limit mean anything.
		const cfg = buildRateLimitConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
		expect(cfg?.storage).toBe('database')
	})

	it('uses the shared store in every environment it is enabled in', () => {
		for (const env of ['production', 'development']) {
			expect(buildRateLimitConfig({ NODE_ENV: env } as NodeJS.ProcessEnv)?.storage).toBe('database')
		}
	})
})
