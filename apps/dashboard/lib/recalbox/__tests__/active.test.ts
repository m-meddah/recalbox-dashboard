import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
	cookies: vi.fn(),
}))

vi.mock('@/lib/config-store', () => ({
	configStore: {
		getRecalbox: vi.fn(),
		getDefaultRecalbox: vi.fn(),
		getRecalboxes: vi.fn(),
	},
}))

import { configStore } from '@/lib/config-store'
import { cookies } from 'next/headers'
import { getActiveRecalboxId } from '../active'

describe('getActiveRecalboxId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns cookie value when Recalbox exists', async () => {
		const jar = { get: vi.fn().mockReturnValue({ value: 'rb-123' }) }
		vi.mocked(cookies).mockResolvedValue(jar as never)
		vi.mocked(configStore.getRecalbox).mockReturnValue({ id: 'rb-123' } as never)

		const id = await getActiveRecalboxId()
		expect(id).toBe('rb-123')
	})

	it('falls back to default when cookie Recalbox not found', async () => {
		const jar = { get: vi.fn().mockReturnValue({ value: 'rb-unknown' }) }
		vi.mocked(cookies).mockResolvedValue(jar as never)
		vi.mocked(configStore.getRecalbox).mockReturnValue(null)
		vi.mocked(configStore.getDefaultRecalbox).mockReturnValue({ id: 'rb-default' } as never)

		const id = await getActiveRecalboxId()
		expect(id).toBe('rb-default')
	})

	it('returns null when no Recalbox configured', async () => {
		const jar = { get: vi.fn().mockReturnValue(undefined) }
		vi.mocked(cookies).mockResolvedValue(jar as never)
		vi.mocked(configStore.getDefaultRecalbox).mockReturnValue(null)
		vi.mocked(configStore.getRecalboxes).mockReturnValue([])

		const id = await getActiveRecalboxId()
		expect(id).toBeNull()
	})
})
