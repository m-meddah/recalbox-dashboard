import { formatUptime } from '@/lib/stats/format-uptime'
import { describe, expect, it } from 'vitest'

describe('formatUptime', () => {
	it('formats days + hours', () => {
		expect(formatUptime(3 * 86400 + 4 * 3600)).toBe('3 j 4 h')
	})
	it('formats hours + minutes under a day', () => {
		expect(formatUptime(5 * 3600 + 30 * 60)).toBe('5 h 30 min')
	})
	it('formats minutes under an hour', () => {
		expect(formatUptime(42 * 60)).toBe('42 min')
	})
	it('returns a dash for invalid input', () => {
		expect(formatUptime(-1)).toBe('—')
		expect(formatUptime(Number.NaN)).toBe('—')
	})
})
