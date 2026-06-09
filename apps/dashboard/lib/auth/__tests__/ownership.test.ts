import { afterEach, describe, expect, it, vi } from 'vitest'

const listRecalboxes = vi.fn()
vi.mock('@/lib/db/recalbox-queries', () => ({ listRecalboxes: () => listRecalboxes() }))

import { canControlRecalbox, canViewRecalbox, getViewableRecalboxIds } from '../ownership'

const admin = { id: 'admin1', email: 'a@b.c', role: 'admin' }
const member = { id: 'm1', email: 'm@b.c', role: 'member' }

afterEach(() => listRecalboxes.mockReset())

function rows() {
	return [
		{ id: 'rb-m1', ownerUserId: 'm1' },
		{ id: 'rb-m2', ownerUserId: 'm2' },
		{ id: 'rb-unowned', ownerUserId: null },
	]
}

describe('getViewableRecalboxIds', () => {
	it('returns all recalboxes for an admin', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(getViewableRecalboxIds(admin).sort()).toEqual(['rb-m1', 'rb-m2', 'rb-unowned'])
	})
	it('returns only owned recalboxes for a member', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(getViewableRecalboxIds(member)).toEqual(['rb-m1'])
	})
})

describe('canViewRecalbox', () => {
	it('admin can view any', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canViewRecalbox(admin, 'rb-m2')).toBe(true)
	})
	it('member cannot view others', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canViewRecalbox(member, 'rb-m2')).toBe(false)
	})
})

describe('canControlRecalbox', () => {
	it('owner can control own', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canControlRecalbox(member, 'rb-m1')).toBe(true)
	})
	it('admin canNOT control a machine they do not own', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canControlRecalbox(admin, 'rb-m2')).toBe(false)
	})
	it('nobody can control an unowned machine', () => {
		listRecalboxes.mockReturnValue(rows())
		expect(canControlRecalbox(admin, 'rb-unowned')).toBe(false)
		expect(canControlRecalbox(member, 'rb-unowned')).toBe(false)
	})
})
