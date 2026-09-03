import { readFleetVersions } from '@/lib/db/agent-rollout-queries'
import { describe, expect, it } from 'vitest'

const HOUR = 60 * 60 * 1000

function fakeDb(rows: unknown[]) {
	const chain = {
		from: () => chain,
		where: () => chain,
		all: async () => rows,
	}
	return { select: () => chain } as never
}

describe('readFleetVersions', () => {
	it('counts one box per version and how many spoke in the last hour', async () => {
		const now = Date.now()
		const res = await readFleetVersions(
			fakeDb([
				{ recalboxId: 'a', version: '1.1.0', lastUsedAt: new Date(now - 60_000) },
				{ recalboxId: 'b', version: '1.0.0', lastUsedAt: new Date(now - 60_000) },
				{ recalboxId: 'c', version: '1.0.0', lastUsedAt: new Date(now - 5 * HOUR) },
			]),
		)
		expect(res).toEqual([
			{ version: '1.1.0', boxes: 1, seenLastHour: 1 },
			{ version: '1.0.0', boxes: 2, seenLastHour: 1 },
		])
	})

	it('counts a box once even when it holds several tokens', async () => {
		// A box that was re-installed keeps its old token rows; counting rows
		// instead of boxes would inflate the fleet and make a rollout look
		// healthier than it is.
		const now = Date.now()
		const res = await readFleetVersions(
			fakeDb([
				{ recalboxId: 'a', version: '1.0.0', lastUsedAt: new Date(now - 10 * HOUR) },
				{ recalboxId: 'a', version: '1.1.0', lastUsedAt: new Date(now - 60_000) },
			]),
		)
		expect(res).toEqual([{ version: '1.1.0', boxes: 1, seenLastHour: 1 }])
	})

	it('is empty when no box ever declared a version', async () => {
		expect(await readFleetVersions(fakeDb([]))).toEqual([])
	})
})
