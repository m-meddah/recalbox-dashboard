import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()
const systemOverviews = vi.fn()
const missingGamesOf = vi.fn()
const romFilesOf = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({ canViewRecalbox: (...a: unknown[]) => canView(...a) }))
vi.mock('@/lib/rom-audit/read-service', () => ({
	OWNED_LEVELS: ['verified', 'serial', 'named'],
	systemOverviews: (...a: unknown[]) => systemOverviews(...a),
	missingGamesOf: (...a: unknown[]) => missingGamesOf(...a),
	romFilesOf: (...a: unknown[]) => romFilesOf(...a),
}))

import { GET as EXPORT } from '../export/route'
import { GET as DETAIL } from '../systems/[system]/route'
import { GET as OVERVIEW } from '../systems/route'

const req = (url: string) => ({ url }) as never
const ctx = (system: string) => ({ params: Promise.resolve({ system }) }) as never

function game(title: string) {
	return {
		title,
		regions: ['Europe'],
		categories: [],
		entries: [{ game: { name: `${title} (Europe)` }, rom: { name: `${title}.gg`, size: 1024 } }],
		owned: false,
		ownedDiscs: [],
		missingDiscs: [],
	}
}

afterEach(() => {
	for (const m of [getUser, canView, systemOverviews, missingGamesOf, romFilesOf]) m.mockReset()
})

function authed() {
	getUser.mockResolvedValue({ id: 'm1', role: 'member' })
	canView.mockResolvedValue(true)
}

describe('GET /api/rom-audit/systems', () => {
	it('401s when unauthenticated', async () => {
		getUser.mockResolvedValue(null)
		expect((await OVERVIEW(req('http://x/?recalboxId=rb-1'))).status).toBe(401)
	})

	it('404s when the user cannot view the Recalbox', async () => {
		getUser.mockResolvedValue({ id: 'm1' })
		canView.mockResolvedValue(false)
		expect((await OVERVIEW(req('http://x/?recalboxId=rb-1'))).status).toBe(404)
	})

	it('returns the overview of every audited system', async () => {
		authed()
		systemOverviews.mockResolvedValue([{ system: 'snes', percent: 30 }])
		const body = await (await OVERVIEW(req('http://x/?recalboxId=rb-1'))).json()
		expect(body.systems).toHaveLength(1)
	})
})

describe('GET /api/rom-audit/systems/[system]', () => {
	it('defaults to the missing tab, which is the actionable list', async () => {
		authed()
		missingGamesOf.mockResolvedValue({ status: 'ok', games: [game('Sonic')], total: 1 })
		const body = await (await DETAIL(req('http://x/?recalboxId=rb-1'), ctx('gamegear'))).json()
		expect(body.games).toHaveLength(1)
		expect(body.total).toBe(1)
	})

	// The tag parser emits lower-case categories; a raw `?exclude=Proto` would
	// silently filter nothing.
	it('lower-cases the excluded categories and keeps region case', async () => {
		authed()
		missingGamesOf.mockResolvedValue({ status: 'ok', games: [], total: 0 })
		await DETAIL(req('http://x/?recalboxId=rb-1&exclude=Proto&region=Europe'), ctx('gamegear'))
		expect(missingGamesOf).toHaveBeenCalledWith('rb-1', 'gamegear', {
			regions: ['Europe'],
			excludeCategories: ['proto'],
		})
	})

	it('404s for a system that was never audited', async () => {
		authed()
		missingGamesOf.mockResolvedValue({ status: 'not-audited' })
		expect((await DETAIL(req('http://x/?recalboxId=rb-1'), ctx('psx'))).status).toBe(404)
	})

	it('explains why the missing list is empty when there is no catalogue', async () => {
		authed()
		missingGamesOf.mockResolvedValue({ status: 'no-catalog' })
		const body = await (await DETAIL(req('http://x/?recalboxId=rb-1'), ctx('amiga'))).json()
		expect(body).toEqual({ games: [], reason: 'no-catalog' })
	})

	// A CHD only ever reaches `named` and an RVZ `serial`: querying `verified`
	// alone would show an empty Owned tab for every disc-based system.
	it('asks for all three owned levels, not just verified', async () => {
		authed()
		romFilesOf.mockResolvedValue({ status: 'ok', files: [] })
		await DETAIL(req('http://x/?recalboxId=rb-1&tab=owned'), ctx('psx'))
		expect(romFilesOf).toHaveBeenCalledWith('rb-1', 'psx', ['verified', 'serial', 'named'], {
			limit: 200,
			offset: 0,
		})
	})

	it('asks for the unknown level on the unknown tab', async () => {
		authed()
		romFilesOf.mockResolvedValue({ status: 'ok', files: [] })
		await DETAIL(req('http://x/?recalboxId=rb-1&tab=unknown'), ctx('psx'))
		expect(romFilesOf.mock.calls[0]?.[2]).toEqual(['unknown'])
	})

	it('caps the page size', async () => {
		authed()
		romFilesOf.mockResolvedValue({ status: 'ok', files: [] })
		await DETAIL(req('http://x/?recalboxId=rb-1&tab=owned&limit=99999'), ctx('psx'))
		expect(romFilesOf.mock.calls[0]?.[3]).toEqual({ limit: 1000, offset: 0 })
	})

	it('says the cloud holds aggregates only rather than returning an empty list', async () => {
		authed()
		romFilesOf.mockResolvedValue({ status: 'aggregates-only' })
		const body = await (await DETAIL(req('http://x/?recalboxId=rb-1&tab=owned'), ctx('psx'))).json()
		expect(body).toEqual({ files: [], reason: 'aggregates-only' })
	})

	it('400s on an unknown tab', async () => {
		authed()
		expect((await DETAIL(req('http://x/?recalboxId=rb-1&tab=nope'), ctx('psx'))).status).toBe(400)
	})
})

describe('GET /api/rom-audit/export', () => {
	it('serves a csv attachment', async () => {
		authed()
		missingGamesOf.mockResolvedValue({ status: 'ok', games: [game('Sonic')], total: 1 })
		const res = await EXPORT(req('http://x/?recalboxId=rb-1&system=gamegear'))
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/csv')
		expect(res.headers.get('content-disposition')).toContain('rom-audit-gamegear.csv')
		expect(await res.text()).toContain('Sonic.gg')
	})

	it('serves json when asked', async () => {
		authed()
		missingGamesOf.mockResolvedValue({ status: 'ok', games: [game('Sonic')], total: 1 })
		const res = await EXPORT(req('http://x/?recalboxId=rb-1&system=gamegear&format=json'))
		expect((await res.json()).games).toHaveLength(1)
	})

	it('400s on an unsupported format', async () => {
		authed()
		const res = await EXPORT(req('http://x/?recalboxId=rb-1&system=gamegear&format=xls'))
		expect(res.status).toBe(400)
	})

	it('404s for a system that was never audited', async () => {
		authed()
		missingGamesOf.mockResolvedValue({ status: 'not-audited' })
		expect((await EXPORT(req('http://x/?recalboxId=rb-1&system=psx'))).status).toBe(404)
	})

	it('sanitises the filename it puts in the header', async () => {
		authed()
		missingGamesOf.mockResolvedValue({ status: 'ok', games: [], total: 0 })
		const res = await EXPORT(req('http://x/?recalboxId=rb-1&system=my%20system'))
		expect(res.headers.get('content-disposition')).toBe(
			'attachment; filename="rom-audit-my_system.csv"',
		)
	})
})
