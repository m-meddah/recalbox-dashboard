import { type RolloutInput, bucketFor, resolveTargetVersion } from '@/lib/agent/rollout'
import { describe, expect, it } from 'vitest'

function input(over: Partial<RolloutInput> = {}): RolloutInput {
	return {
		channel: 'stable',
		recalboxId: 'rb-1',
		currentVersion: '1.0.0',
		targetVersion: '1.1.0',
		rolloutPercent: 0,
		...over,
	}
}

describe('bucketFor', () => {
	it('is deterministic for a given id', () => {
		expect(bucketFor('rb-1')).toBe(bucketFor('rb-1'))
	})

	it('stays within 0..99', () => {
		for (const id of ['a', 'b', 'c', 'rb-1', 'rb-2', 'rb-3']) {
			const b = bucketFor(id)
			expect(b).toBeGreaterThanOrEqual(0)
			expect(b).toBeLessThan(100)
		}
	})
})

describe('resolveTargetVersion', () => {
	it('says nothing when the box already runs the target', () => {
		expect(resolveTargetVersion(input({ currentVersion: '1.1.0' }))).toBeNull()
	})

	it('says nothing when the box never declared its version', () => {
		expect(resolveTargetVersion(input({ currentVersion: null, rolloutPercent: 100 }))).toBeNull()
	})

	it('holds a stable box back at 0 percent', () => {
		expect(resolveTargetVersion(input())).toBeNull()
	})

	it('serves every stable box at 100 percent', () => {
		expect(resolveTargetVersion(input({ rolloutPercent: 100 }))).toBe('1.1.0')
	})

	it('serves a beta box whatever the percentage', () => {
		expect(resolveTargetVersion(input({ channel: 'beta', rolloutPercent: 0 }))).toBe('1.1.0')
	})

	it('never filters a descent — the emergency button is one gesture', () => {
		const res = resolveTargetVersion(
			input({ currentVersion: '1.1.0', targetVersion: '1.0.0', rolloutPercent: 0 }),
		)
		expect(res).toBe('1.0.0')
	})

	it('keeps a box in the batch as the percentage rises', () => {
		// A box drawn at 10% must still be in at 25% and 50%, otherwise boxes would
		// oscillate between two versions every 60 seconds.
		const ids = Array.from({ length: 200 }, (_, i) => `rb-${i}`)
		const at10 = ids.filter((id) => resolveTargetVersion(input({ recalboxId: id, rolloutPercent: 10 })))
		expect(at10.length).toBeGreaterThan(0)
		for (const id of at10) {
			expect(resolveTargetVersion(input({ recalboxId: id, rolloutPercent: 25 }))).toBe('1.1.0')
			expect(resolveTargetVersion(input({ recalboxId: id, rolloutPercent: 50 }))).toBe('1.1.0')
		}
	})
})
