import { beforeEach, describe, expect, it, vi } from 'vitest'

const listRecalboxes = vi.fn()
vi.mock('@/lib/db/recalbox-queries', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/db/recalbox-queries')>()
	return { ...actual, listRecalboxes: () => listRecalboxes() }
})

import { loadRecalbox, loadRecalboxes } from '../recalbox-acl'

const row = (id: string, ownerUserId: string | null) => ({
	id,
	name: id,
	host: 'h',
	sshUser: 'u',
	sshPassword: 'p',
	sshPort: 22,
	mqttPort: 1883,
	color: null,
	iconEmoji: null,
	ownerUserId,
	isDefault: false,
	archived: false,
})

beforeEach(() => listRecalboxes.mockReset())

describe('loadRecalboxes', () => {
	it('maps DB rows to instances', async () => {
		listRecalboxes.mockResolvedValue([row('rb1', 'u1')])
		expect(await loadRecalboxes()).toEqual([
			expect.objectContaining({ id: 'rb1', ownerUserId: 'u1' }),
		])
	})

	// Outside a request scope React's cache() must NOT memoize — otherwise the rows
	// would persist across requests on a warm instance and we would be right back to
	// the stale-authorization bug this module exists to fix.
	it('re-reads the DB on each call outside a request scope', async () => {
		listRecalboxes.mockResolvedValue([row('rb1', 'u1')])
		await loadRecalboxes()
		listRecalboxes.mockResolvedValue([row('rb1', 'u2')])
		expect((await loadRecalboxes())[0]?.ownerUserId).toBe('u2')
		expect(listRecalboxes).toHaveBeenCalledTimes(2)
	})

	it('fails closed to an empty list when the DB read fails', async () => {
		// listRecalboxes() swallows errors and returns [] — access is denied, not granted.
		listRecalboxes.mockResolvedValue([])
		expect(await loadRecalboxes()).toEqual([])
	})
})

describe('loadRecalbox', () => {
	it('returns the matching box, or null when absent', async () => {
		listRecalboxes.mockResolvedValue([row('rb1', 'u1'), row('rb2', null)])
		expect((await loadRecalbox('rb2'))?.id).toBe('rb2')
		expect(await loadRecalbox('nope')).toBeNull()
	})
})
