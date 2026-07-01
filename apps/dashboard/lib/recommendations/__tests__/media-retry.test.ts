import { describe, expect, it } from 'vitest'
import { getRetryDelayMs, withCacheBust } from '../media-retry'

describe('getRetryDelayMs', () => {
	it('returns increasing delays for early attempts', () => {
		const first = getRetryDelayMs(0)
		const second = getRetryDelayMs(1)
		expect(first).not.toBeNull()
		expect(second).not.toBeNull()
		expect(second as number).toBeGreaterThan(first as number)
	})

	it('returns null once attempts are exhausted', () => {
		let attempt = 0
		while (getRetryDelayMs(attempt) !== null) attempt++
		expect(getRetryDelayMs(attempt)).toBeNull()
	})

	it("covers at least the agent's default 30s artwork poll interval", () => {
		let attempt = 0
		let total = 0
		let delay = getRetryDelayMs(attempt)
		while (delay !== null) {
			total += delay
			attempt++
			delay = getRetryDelayMs(attempt)
		}
		expect(total).toBeGreaterThanOrEqual(30_000)
	})
})

describe('withCacheBust', () => {
	it('returns the original url unchanged on the first attempt', () => {
		expect(withCacheBust('/api/media?path=%2Fa.png', 0)).toBe('/api/media?path=%2Fa.png')
	})

	it('appends a cache-busting param on retries', () => {
		expect(withCacheBust('/api/media?path=%2Fa.png', 1)).toBe('/api/media?path=%2Fa.png&retry=1')
	})

	it('produces a different url for each retry attempt', () => {
		const a = withCacheBust('/api/media?path=%2Fa.png', 1)
		const b = withCacheBust('/api/media?path=%2Fa.png', 2)
		expect(a).not.toBe(b)
	})
})
