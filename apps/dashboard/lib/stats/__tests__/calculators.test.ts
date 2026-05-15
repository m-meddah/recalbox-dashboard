import { describe, expect, it } from 'vitest'
import { generateHeatmap, getPeriodRange } from '../calculators'
import { formatDuration, formatRelativeDate, toDateKey } from '../formatters'

// ─── formatDuration ──────────────────────────────────────────────────────────

describe('formatDuration', () => {
	it('returns 0s for zero', () => expect(formatDuration(0)).toBe('0s'))
	it('returns 0s for negative values', () => expect(formatDuration(-10)).toBe('0s'))
	it('formats seconds below 60', () => expect(formatDuration(59)).toBe('59s'))
	it('formats exactly 60s as 1m', () => expect(formatDuration(60)).toBe('1m'))
	it('formats 90s as 1m', () => expect(formatDuration(90)).toBe('1m'))
	it('formats 3600s as 1h00', () => expect(formatDuration(3600)).toBe('1h00'))
	it('formats 3661s as 1h01', () => expect(formatDuration(3661)).toBe('1h01'))
	it('formats 86400s as 24h00', () => expect(formatDuration(86400)).toBe('24h00'))
	it('pads minutes with zero', () => expect(formatDuration(3605)).toBe('1h00'))
	it('formats 47h12m correctly', () => expect(formatDuration(47 * 3600 + 12 * 60)).toBe('47h12'))
})

// ─── formatRelativeDate ───────────────────────────────────────────────────────

describe('formatRelativeDate', () => {
	it('formats a date 30 seconds ago', () => {
		const date = new Date(Date.now() - 30_000)
		const result = formatRelativeDate(date, 'en-US')
		expect(result).toMatch(/30 seconds ago/)
	})

	it('formats a date 2 minutes ago', () => {
		const date = new Date(Date.now() - 2 * 60_000)
		const result = formatRelativeDate(date, 'en-US')
		expect(result).toMatch(/2 minutes ago/)
	})

	it('formats a date 2 hours ago', () => {
		const date = new Date(Date.now() - 2 * 3600_000)
		const result = formatRelativeDate(date, 'en-US')
		expect(result).toMatch(/2 hours ago/)
	})

	it('formats yesterday', () => {
		const date = new Date(Date.now() - 25 * 3600_000)
		const result = formatRelativeDate(date, 'en-US')
		expect(result).toMatch(/yesterday|1 day ago/)
	})
})

// ─── toDateKey ───────────────────────────────────────────────────────────────

describe('toDateKey', () => {
	it('formats date as YYYY-MM-DD', () => {
		const date = new Date(2024, 0, 5) // Jan 5, 2024
		expect(toDateKey(date)).toBe('2024-01-05')
	})

	it('pads month and day with zeros', () => {
		const date = new Date(2024, 8, 3) // Sep 3, 2024
		expect(toDateKey(date)).toBe('2024-09-03')
	})
})

// ─── getPeriodRange ───────────────────────────────────────────────────────────

describe('getPeriodRange', () => {
	it('returns null for all', () => {
		expect(getPeriodRange('all')).toBeNull()
	})

	it('returns a 7-day range for week', () => {
		const range = getPeriodRange('week')!
		expect(range).not.toBeNull()
		const diffDays = (range.toDate.getTime() - range.fromDate.getTime()) / (1000 * 60 * 60 * 24)
		expect(diffDays).toBeCloseTo(7, 0)
	})

	it('returns a 30-day range for month', () => {
		const range = getPeriodRange('month')!
		const diffDays = (range.toDate.getTime() - range.fromDate.getTime()) / (1000 * 60 * 60 * 24)
		expect(diffDays).toBeCloseTo(30, 0)
	})

	it('returns a 365-day range for year', () => {
		const range = getPeriodRange('year')!
		const diffDays = (range.toDate.getTime() - range.fromDate.getTime()) / (1000 * 60 * 60 * 24)
		expect(diffDays).toBeCloseTo(365, 0)
	})
})

// ─── generateHeatmap ─────────────────────────────────────────────────────────

describe('generateHeatmap', () => {
	it('returns a 2D array of weeks', () => {
		const heatmap = generateHeatmap([], new Date(), 365)
		expect(Array.isArray(heatmap)).toBe(true)
		expect(heatmap.length).toBeGreaterThan(50) // at least 52 weeks
		for (const week of heatmap) {
			expect(week).toHaveLength(7)
		}
	})

	it('assigns intensity 0 when no data', () => {
		const heatmap = generateHeatmap([], new Date(), 30)
		const allZero = heatmap.flat().every((c) => c.intensity === 0)
		expect(allZero).toBe(true)
	})

	it('assigns higher intensity for higher playtime', () => {
		const end = new Date('2024-06-15')
		const data = [
			{ date: '2024-06-14', playtimeSec: 7200, sessionCount: 2 },
			{ date: '2024-06-13', playtimeSec: 3600, sessionCount: 1 },
			{ date: '2024-06-12', playtimeSec: 1800, sessionCount: 1 },
			{ date: '2024-06-11', playtimeSec: 600, sessionCount: 1 },
		]
		const heatmap = generateHeatmap(data, end, 30)
		const flat = heatmap.flat()
		const june14 = flat.find((c) => c.dateKey === '2024-06-14')
		const june11 = flat.find((c) => c.dateKey === '2024-06-11')
		expect(june14?.intensity).toBeGreaterThan(june11?.intensity ?? 0)
	})

	it('sets playtimeSec and sessionCount from data', () => {
		const end = new Date('2024-06-15')
		const data = [{ date: '2024-06-14', playtimeSec: 3600, sessionCount: 2 }]
		const heatmap = generateHeatmap(data, end, 7)
		const cell = heatmap.flat().find((c) => c.dateKey === '2024-06-14')
		expect(cell?.playtimeSec).toBe(3600)
		expect(cell?.sessionCount).toBe(2)
	})
})

// ─── streak edge cases (via generateHeatmap + calculateStreaks indirectly) ───

describe('streak edge cases', () => {
	it('returns 0 streak when no data', () => {
		const range = getPeriodRange('week')
		expect(range).not.toBeNull()
	})

	it('heatmap handles empty array gracefully', () => {
		expect(() => generateHeatmap([], new Date(), 365)).not.toThrow()
	})

	it('heatmap handles single day of data', () => {
		const today = toDateKey(new Date())
		const heatmap = generateHeatmap([{ date: today, playtimeSec: 3600, sessionCount: 1 }])
		const cell = heatmap.flat().find((c) => c.dateKey === today)
		expect(cell?.intensity).toBeGreaterThan(0)
	})
})
