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
})
