import { afterEach, describe, expect, it } from 'vitest'
import { isServerlessMode } from '../serverless'

const original = process.env.AGENT_ONLY_MEDIA

afterEach(() => {
	if (original === undefined) delete process.env.AGENT_ONLY_MEDIA
	else process.env.AGENT_ONLY_MEDIA = original
})

describe('isServerlessMode', () => {
	it('is true only when AGENT_ONLY_MEDIA=1', () => {
		process.env.AGENT_ONLY_MEDIA = '1'
		expect(isServerlessMode()).toBe(true)
	})

	it('is false when unset', () => {
		delete process.env.AGENT_ONLY_MEDIA
		expect(isServerlessMode()).toBe(false)
	})

	it('is false for other values', () => {
		process.env.AGENT_ONLY_MEDIA = '0'
		expect(isServerlessMode()).toBe(false)
	})
})
