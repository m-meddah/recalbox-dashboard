import { compareVersions } from '@/lib/agent/version'
import { describe, expect, it } from 'vitest'

describe('compareVersions', () => {
	it('orders by numeric segment, not lexicographically', () => {
		expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
		expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0)
	})

	it('treats equal versions as equal', () => {
		expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
	})

	it('pads missing segments with zero', () => {
		expect(compareVersions('1.1', '1.1.0')).toBe(0)
		expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0)
	})

	it('reads a non-numeric segment as zero rather than throwing', () => {
		expect(compareVersions('1.x.0', '1.0.0')).toBe(0)
		expect(compareVersions('', '0.0.0')).toBe(0)
	})

	it('matches the agent-side rule', () => {
		// The same table is asserted in agent/test_updater.py. Two
		// implementations, one rule — they must not drift.
		expect(compareVersions('1.10rc1.0', '1.10.0')).toBeLessThan(0)
	})
})
