import { describe, expect, it } from 'vitest'
import {
	MAX_RECONNECT_MS,
	RECONNECT_BASE_MS,
	REFUSED_BASE_MS,
	reconnectDelay,
} from '../reconnect-delay'

describe('reconnectDelay', () => {
	it('starts at the base delay on the first failure', () => {
		expect(reconnectDelay(1, false)).toBe(RECONNECT_BASE_MS)
		expect(reconnectDelay(1, true)).toBe(REFUSED_BASE_MS)
	})

	it('doubles per consecutive failure', () => {
		expect(reconnectDelay(2, false)).toBe(RECONNECT_BASE_MS * 2)
		expect(reconnectDelay(3, false)).toBe(RECONNECT_BASE_MS * 4)
	})

	it('caps the delay', () => {
		expect(reconnectDelay(99, false)).toBe(MAX_RECONNECT_MS)
		expect(reconnectDelay(99, true)).toBe(MAX_RECONNECT_MS)
	})

	// The regression: a refused stream (expired session / lost access) used to retry on
	// a flat 3s forever, spinning up a serverless invocation each time for as long as
	// the tab stayed open.
	it('backs off far harder when the server refused the stream', () => {
		expect(reconnectDelay(1, true)).toBeGreaterThan(reconnectDelay(1, false))
		expect(reconnectDelay(1, true)).toBeGreaterThanOrEqual(30_000)
	})

	it('never returns a zero or negative delay', () => {
		for (const attempt of [0, 1, 5]) {
			expect(reconnectDelay(attempt, false)).toBeGreaterThan(0)
		}
	})
})
