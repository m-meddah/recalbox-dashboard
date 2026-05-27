import { describe, expect, it } from 'vitest'
import { classifySession } from '../classify'

describe('classifySession', () => {
	it('classifies null/undefined as noise', () => {
		expect(classifySession(null)).toBe('noise')
		expect(classifySession(undefined)).toBe('noise')
	})

	it('classifies < 2 min as noise', () => {
		expect(classifySession(0)).toBe('noise')
		expect(classifySession(60)).toBe('noise')
		expect(classifySession(119)).toBe('noise')
	})

	it('classifies 2-10 min as bounce', () => {
		expect(classifySession(120)).toBe('bounce')
		expect(classifySession(300)).toBe('bounce')
		expect(classifySession(599)).toBe('bounce')
	})

	it('classifies 10-30 min as taste', () => {
		expect(classifySession(600)).toBe('taste')
		expect(classifySession(1200)).toBe('taste')
		expect(classifySession(1799)).toBe('taste')
	})

	it('classifies 30 min - 2 h as meaningful', () => {
		expect(classifySession(1800)).toBe('meaningful')
		expect(classifySession(3600)).toBe('meaningful')
		expect(classifySession(7199)).toBe('meaningful')
	})

	it('classifies > 2 h as marathon', () => {
		expect(classifySession(7200)).toBe('marathon')
		expect(classifySession(14400)).toBe('marathon')
		expect(classifySession(36000)).toBe('marathon')
	})
})
