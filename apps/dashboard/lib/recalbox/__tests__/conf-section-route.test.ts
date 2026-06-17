import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getActiveRecalboxId = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()
const readConfKeys = vi.fn()
const writeConfKeys = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canViewRecalbox: (...a: unknown[]) => canView(...a),
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
}))
vi.mock('@/lib/recalbox/active', () => ({ getActiveRecalboxId: () => getActiveRecalboxId() }))
vi.mock('@/lib/recalbox/conf-keys', () => ({
	readConfKeys: (...a: unknown[]) => readConfKeys(...a),
	writeConfKeys: (...a: unknown[]) => writeConfKeys(...a),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import type { FieldSpec } from '../conf-section'
import { createConfSectionHandlers } from '../conf-section-route'

const SPECS: FieldSpec[] = [
	{ key: 'x.on', type: 'boolean' },
	{ key: 'x.mode', type: 'enum', options: ['a', 'b'] },
]
const { GET, POST } = createConfSectionHandlers(SPECS, 'test')

function postReq(body: unknown) {
	return new Request('http://x/api/recalbox/test', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	})
}

afterEach(() => {
	for (const m of [getUser, getActiveRecalboxId, canView, canControl, readConfKeys, writeConfKeys])
		m.mockReset()
})

describe('createConfSectionHandlers GET', () => {
	it('returns decoded values', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canView.mockReturnValue(true)
		readConfKeys.mockResolvedValue({ 'x.on': '1', 'x.mode': 'b' })
		const res = await GET()
		const json = await res.json()
		expect(json.values).toEqual({ 'x.on': true, 'x.mode': 'b' })
	})

	it('401s without a user', async () => {
		getUser.mockResolvedValue(null)
		expect((await GET()).status).toBe(401)
	})
})

describe('createConfSectionHandlers POST', () => {
	it('400s on an invalid enum before touching the device', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		const res = await POST(postReq({ values: { 'x.mode': 'evil' } }))
		expect(res.status).toBe(400)
		expect(writeConfKeys).not.toHaveBeenCalled()
	})

	it('403s when the user cannot control the recalbox', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-2')
		canControl.mockReturnValue(false)
		const res = await POST(postReq({ values: { 'x.on': true } }))
		expect(res.status).toBe(403)
		expect(writeConfKeys).not.toHaveBeenCalled()
	})

	it('writes validated changes on success', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		writeConfKeys.mockResolvedValue(true)
		const res = await POST(postReq({ values: { 'x.on': true, 'x.mode': 'a' } }))
		expect(res.status).toBe(200)
		const [, changes] = writeConfKeys.mock.calls[0] ?? []
		expect(changes).toEqual({ 'x.on': '1', 'x.mode': 'a' })
	})

	it('404s when recalbox.conf is missing', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		writeConfKeys.mockResolvedValue(false)
		const res = await POST(postReq({ values: { 'x.on': true } }))
		expect(res.status).toBe(404)
	})
})
