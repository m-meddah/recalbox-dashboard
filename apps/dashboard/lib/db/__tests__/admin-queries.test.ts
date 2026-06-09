import { describe, expect, it, vi } from 'vitest'
import { getAdminOverview } from '../admin-queries'
import type { SessionStats } from '../queries'

function zeroStats(): SessionStats {
	return {
		totalPlaytimeSec: 0,
		totalSessions: 0,
		uniqueGames: 0,
		avgSessionSec: 0,
		byDay: [],
		bySystem: [],
		topGames: [],
	}
}

function statsWith(sec: number): SessionStats {
	return { ...zeroStats(), totalPlaytimeSec: sec, totalSessions: 1 }
}

const users = [
	{ id: 'u1', email: 'a@x.c', role: 'admin' },
	{ id: 'u2', email: 'b@x.c', role: 'member' },
	{ id: 'u3', email: 'c@x.c', role: 'member' },
]

const recalboxes = [
	{ id: 'rb1', name: 'Pi5', iconEmoji: '🎮', archived: false, ownerUserId: 'u1' },
	{ id: 'rb2', name: 'Pi4', iconEmoji: null, archived: false, ownerUserId: 'u2' },
	{ id: 'rb3', name: 'Pi3', iconEmoji: null, archived: true, ownerUserId: 'u2' },
	{ id: 'rb4', name: 'Spare', iconEmoji: null, archived: false, ownerUserId: null },
]

function makeDeps() {
	const getStats = vi.fn(async (ids: string[]) => statsWith(ids.length * 100))
	return {
		listUsers: () => users,
		// biome-ignore lint/suspicious/noExplicitAny: test fixture row shape
		listRecalboxes: () => recalboxes as any,
		getStats,
	}
}

describe('getAdminOverview', () => {
	it('returns one entry per user with their machines', async () => {
		const overview = await getAdminOverview(makeDeps())
		expect(overview.users.map((u) => u.user.id)).toEqual(['u1', 'u2', 'u3'])
		// biome-ignore lint/style/noNonNullAssertion: test fixture always contains u2
		const u2 = overview.users.find((u) => u.user.id === 'u2')!
		expect(u2.machines.map((m) => m.id)).toEqual(['rb2', 'rb3'])
	})

	it('aggregates stats over the user-owned set', async () => {
		const overview = await getAdminOverview(makeDeps())
		// biome-ignore lint/style/noNonNullAssertion: test fixture always contains u2
		const u2 = overview.users.find((u) => u.user.id === 'u2')!
		expect(u2.stats.totalPlaytimeSec).toBe(200) // 2 machines * 100
	})

	it('gives a user with no machines an empty stat block', async () => {
		const deps = makeDeps()
		const overview = await getAdminOverview(deps)
		// biome-ignore lint/style/noNonNullAssertion: test fixture always contains u3
		const u3 = overview.users.find((u) => u.user.id === 'u3')!
		expect(u3.machines).toEqual([])
		expect(u3.stats.totalPlaytimeSec).toBe(0)
		expect(deps.getStats).toHaveBeenCalledWith([])
	})

	it('groups unowned machines into the unassigned bucket', async () => {
		const overview = await getAdminOverview(makeDeps())
		expect(overview.unassigned).not.toBeNull()
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null on previous line
		expect(overview.unassigned!.machines.map((m) => m.id)).toEqual(['rb4'])
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null on previous line
		expect(overview.unassigned!.stats.totalPlaytimeSec).toBe(100)
	})

	it('returns null unassigned when every machine is owned', async () => {
		const deps = makeDeps()
		deps.listRecalboxes = () => [recalboxes[0], recalboxes[1]] as never
		const overview = await getAdminOverview(deps)
		expect(overview.unassigned).toBeNull()
	})
})
