import { afterEach, describe, expect, it, vi } from 'vitest'

const markWanted = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/artwork', () => ({
	markWanted: (...a: unknown[]) => markWanted(...a),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { prefetchArtwork } from '../artwork-prefetch'

afterEach(() => {
	markWanted.mockReset()
})

describe('prefetchArtwork', () => {
	it('marks each image and video path wanted', async () => {
		markWanted.mockResolvedValue(undefined)
		await prefetchArtwork('rb1', [
			{ imageUrl: '/a.png', videoUrl: '/a.mp4' },
			{ imageUrl: '/b.png', videoUrl: null },
		])
		expect(markWanted).toHaveBeenCalledTimes(3)
		expect(markWanted).toHaveBeenCalledWith({}, 'rb1', '/a.png')
		expect(markWanted).toHaveBeenCalledWith({}, 'rb1', '/a.mp4')
		expect(markWanted).toHaveBeenCalledWith({}, 'rb1', '/b.png')
	})

	it('dedupes the same path repeated across games', async () => {
		markWanted.mockResolvedValue(undefined)
		await prefetchArtwork('rb1', [
			{ imageUrl: '/shared.png', videoUrl: null },
			{ imageUrl: '/shared.png', videoUrl: null },
		])
		expect(markWanted).toHaveBeenCalledTimes(1)
	})

	it('skips games with no image or video', async () => {
		await prefetchArtwork('rb1', [{ imageUrl: null, videoUrl: null }])
		expect(markWanted).not.toHaveBeenCalled()
	})

	it('does not reject when a markWanted call fails', async () => {
		markWanted.mockRejectedValue(new Error('db down'))
		await expect(
			prefetchArtwork('rb1', [{ imageUrl: '/a.png', videoUrl: null }]),
		).resolves.toBeUndefined()
	})
})
