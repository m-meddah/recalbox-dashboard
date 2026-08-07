import { afterEach, describe, expect, it, vi } from 'vitest'

const markWantedMany = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/artwork', () => ({
	markWantedMany: (...a: unknown[]) => markWantedMany(...a),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import { prefetchArtwork } from '../artwork-prefetch'

afterEach(() => {
	markWantedMany.mockReset()
})

/** The paths of the single batched call, sorted so assertions ignore Set order. */
function markedPaths(): string[] {
	return [...(markWantedMany.mock.calls[0]?.[2] as string[])].sort()
}

describe('prefetchArtwork', () => {
	it('marks every image and video path wanted in one batch', async () => {
		markWantedMany.mockResolvedValue(undefined)
		await prefetchArtwork('rb1', [
			{ imagePath: '/a.png', videoPath: '/a.mp4' },
			{ imagePath: '/b.png', videoPath: null },
		])
		expect(markWantedMany).toHaveBeenCalledTimes(1)
		expect(markWantedMany.mock.calls[0]?.[1]).toBe('rb1')
		expect(markedPaths()).toEqual(['/a.mp4', '/a.png', '/b.png'])
	})

	it('dedupes the same path repeated across games', async () => {
		markWantedMany.mockResolvedValue(undefined)
		await prefetchArtwork('rb1', [
			{ imagePath: '/shared.png', videoPath: null },
			{ imagePath: '/shared.png', videoPath: null },
		])
		expect(markedPaths()).toEqual(['/shared.png'])
	})

	it('skips games with no image or video', async () => {
		markWantedMany.mockResolvedValue(undefined)
		await prefetchArtwork('rb1', [{ imagePath: null, videoPath: null }])
		expect(markedPaths()).toEqual([])
	})

	it('does not reject when the batch fails', async () => {
		markWantedMany.mockRejectedValue(new Error('db down'))
		await expect(
			prefetchArtwork('rb1', [{ imagePath: '/a.png', videoPath: null }]),
		).resolves.toBeUndefined()
	})
})
