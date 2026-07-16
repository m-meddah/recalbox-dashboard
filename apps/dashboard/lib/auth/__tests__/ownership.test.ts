import { afterEach, describe, expect, it, vi } from 'vitest'

const loadRecalboxes = vi.fn()
vi.mock('@/lib/auth/recalbox-acl', () => ({ loadRecalboxes: () => loadRecalboxes() }))

import { canControlRecalbox, canViewRecalbox, getViewableRecalboxIds } from '../ownership'

const admin = { id: 'admin1', email: 'a@b.c', role: 'admin' }
const member = { id: 'm1', email: 'm@b.c', role: 'member' }

afterEach(() => loadRecalboxes.mockReset())

function rows() {
	return [
		{ id: 'rb-m1', ownerUserId: 'm1' },
		{ id: 'rb-m2', ownerUserId: 'm2' },
		{ id: 'rb-unowned', ownerUserId: null },
	]
}

describe('getViewableRecalboxIds', () => {
	it('returns all recalboxes for an admin', async () => {
		loadRecalboxes.mockResolvedValue(rows())
		expect((await getViewableRecalboxIds(admin)).sort()).toEqual(['rb-m1', 'rb-m2', 'rb-unowned'])
	})
	it('returns only owned recalboxes for a member', async () => {
		loadRecalboxes.mockResolvedValue(rows())
		expect(await getViewableRecalboxIds(member)).toEqual(['rb-m1'])
	})
})

describe('canViewRecalbox', () => {
	it('admin can view any', async () => {
		loadRecalboxes.mockResolvedValue(rows())
		expect(await canViewRecalbox(admin, 'rb-m2')).toBe(true)
	})
	it('member cannot view others', async () => {
		loadRecalboxes.mockResolvedValue(rows())
		expect(await canViewRecalbox(member, 'rb-m2')).toBe(false)
	})
})

describe('canControlRecalbox', () => {
	it('owner can control own', async () => {
		loadRecalboxes.mockResolvedValue(rows())
		expect(await canControlRecalbox(member, 'rb-m1')).toBe(true)
	})
	it('admin canNOT control a machine they do not own', async () => {
		loadRecalboxes.mockResolvedValue(rows())
		expect(await canControlRecalbox(admin, 'rb-m2')).toBe(false)
	})
	it('nobody can control an unowned machine', async () => {
		loadRecalboxes.mockResolvedValue(rows())
		expect(await canControlRecalbox(admin, 'rb-unowned')).toBe(false)
		expect(await canControlRecalbox(member, 'rb-unowned')).toBe(false)
	})
})

// The whole point of the refactor: ownership must be decided against the DB, never a
// snapshot taken at process boot. A stale row must not keep granting access.
describe('freshness', () => {
	it('re-reads on every check, so a revoked owner loses access immediately', async () => {
		loadRecalboxes.mockResolvedValue([{ id: 'rb-m1', ownerUserId: 'm1' }])
		expect(await canControlRecalbox(member, 'rb-m1')).toBe(true)

		// Ownership reassigned elsewhere (another instance / another user's request).
		loadRecalboxes.mockResolvedValue([{ id: 'rb-m1', ownerUserId: 'someone-else' }])
		expect(await canControlRecalbox(member, 'rb-m1')).toBe(false)
		expect(await canViewRecalbox(member, 'rb-m1')).toBe(false)
	})

	it('denies when the box is gone', async () => {
		loadRecalboxes.mockResolvedValue([])
		expect(await canControlRecalbox(member, 'rb-m1')).toBe(false)
		expect(await getViewableRecalboxIds(member)).toEqual([])
	})
})
