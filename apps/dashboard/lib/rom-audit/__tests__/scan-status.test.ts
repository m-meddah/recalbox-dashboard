import { describe, expect, it } from 'vitest'
import { isScanLive, scanJustFinished, scanPercent } from '../scan-status'

describe('isScanLive', () => {
	// A serverless scan sits in 'pending' until the agent claims its command;
	// treating that as finished would stop the poll before anything happened.
	it('counts a queued scan as live', () => {
		expect(isScanLive({ status: 'pending' })).toBe(true)
		expect(isScanLive({ status: 'running' })).toBe(true)
	})

	it('stops on a terminal status', () => {
		expect(isScanLive({ status: 'done' })).toBe(false)
		expect(isScanLive({ status: 'failed' })).toBe(false)
	})

	it('is false when there has never been a scan', () => {
		expect(isScanLive(null)).toBe(false)
		expect(isScanLive(undefined)).toBe(false)
	})
})

describe('scanJustFinished', () => {
	it('fires once, on the transition out of a live status', () => {
		expect(scanJustFinished({ status: 'running' }, { status: 'done' })).toBe(true)
		expect(scanJustFinished({ status: 'running' }, { status: 'failed' })).toBe(true)
	})

	it('does not fire while the scan is still going', () => {
		expect(scanJustFinished({ status: 'running' }, { status: 'running' })).toBe(false)
	})

	// Otherwise every poll of an already-finished scan would refresh the page.
	it('does not fire when the scan was already finished', () => {
		expect(scanJustFinished({ status: 'done' }, { status: 'done' })).toBe(false)
		expect(scanJustFinished(null, { status: 'done' })).toBe(false)
	})
})

describe('scanPercent', () => {
	it('is the share of systems already audited', () => {
		expect(scanPercent({ status: 'running', systemsDone: 3, systemsTotal: 12 })).toBe(25)
	})

	// The cloud opens an agent scan with systemsTotal = 0: the box has not yet
	// said how many systems it will send. NaN would render as a broken bar.
	it('is zero while the total is still unknown', () => {
		expect(scanPercent({ status: 'pending', systemsDone: 0, systemsTotal: 0 })).toBe(0)
		expect(scanPercent(null)).toBe(0)
	})

	it('never exceeds one hundred', () => {
		expect(scanPercent({ status: 'running', systemsDone: 15, systemsTotal: 12 })).toBe(100)
	})
})
