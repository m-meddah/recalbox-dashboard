import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const getActiveRecalboxId = vi.fn()
const canView = vi.fn()
const canControl = vi.fn()
const fetchConfigSection = vi.fn()
const saveConfigSection = vi.fn()

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
vi.mock('@/lib/config-store', () => ({
	configStore: { getRecalbox: () => ({ host: 'box' }) },
}))
vi.mock('@/lib/recalbox/web-config', async () => {
	const actual = await vi.importActual<typeof import('@/lib/recalbox/web-config')>(
		'@/lib/recalbox/web-config',
	)
	return {
		...actual,
		fetchConfigSection: (...a: unknown[]) => fetchConfigSection(...a),
		saveConfigSection: (...a: unknown[]) => saveConfigSection(...a),
	}
})
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

import { SECRET_SENTINEL } from '@/lib/recalbox/web-config'
import { GET, POST } from '../route'

function ctx(section: string) {
	return { params: Promise.resolve({ section }) }
}
function postReq(body: unknown) {
	return new Request('http://x/api/recalbox/config/audio', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	}) as never
}

afterEach(() => {
	for (const m of [
		getUser,
		getActiveRecalboxId,
		canView,
		canControl,
		fetchConfigSection,
		saveConfigSection,
	])
		m.mockReset()
})

describe('GET /api/recalbox/config/[section]', () => {
	it('404s an unknown section', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		const res = await GET({} as never, ctx('not-a-section'))
		expect(res.status).toBe(404)
	})

	it('masks secret values before returning', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canView.mockReturnValue(true)
		fetchConfigSection.mockResolvedValue([
			{ key: 'user', value: 'bob', exist: true },
			{ key: 'retroachievements.password', value: 'hunter2', exist: true },
		])
		const res = await GET({} as never, ctx('global'))
		const json = await res.json()
		const pwd = json.fields.find((f: { key: string }) => f.key === 'retroachievements.password')
		expect(pwd.value).toBe(SECRET_SENTINEL)
		expect(JSON.stringify(json)).not.toContain('hunter2')
	})
})

describe('POST /api/recalbox/config/[section]', () => {
	it('403s when the user does not own the active recalbox', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-2')
		canControl.mockReturnValue(false)
		const res = await POST(postReq({ changes: { volume: 90 } }), ctx('audio'))
		expect(res.status).toBe(403)
		expect(saveConfigSection).not.toHaveBeenCalled()
	})

	it('drops untouched secret fields left at the sentinel', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		saveConfigSection.mockResolvedValue(undefined)
		const res = await POST(
			postReq({ changes: { 'retroachievements.password': SECRET_SENTINEL, autosave: true } }),
			ctx('global'),
		)
		expect(res.status).toBe(200)
		expect(saveConfigSection).toHaveBeenCalledWith('box', 'global', { autosave: true })
	})

	it('rejects a non-primitive change value', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		getActiveRecalboxId.mockResolvedValue('rb-1')
		canControl.mockReturnValue(true)
		const res = await POST(postReq({ changes: { foo: { nested: 1 } } }), ctx('audio'))
		expect(res.status).toBe(400)
		expect(saveConfigSection).not.toHaveBeenCalled()
	})
})
