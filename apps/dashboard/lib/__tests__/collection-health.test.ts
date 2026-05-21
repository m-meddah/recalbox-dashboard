import { describe, expect, it } from 'vitest'
import { computeCollectionHealth } from '../collection-health'

const base = { romPath: '/roms/game.zip', name: 'Game', system: 'snes' }

describe('computeCollectionHealth', () => {
	it('counts fully scraped games (image + description present)', () => {
		const rows = [
			{ ...base, imagePath: '/img/game.png', description: 'A game', videoPath: null },
			{ ...base, name: 'Game 2', imagePath: '/img/g2.png', description: 'Another', videoPath: '/v.mp4' },
		]
		const health = computeCollectionHealth(rows)
		expect(health.totalGames).toBe(2)
		expect(health.fullyScraped).toBe(2)
		expect(health.missingMedia).toBe(0)
		expect(health.unscrapedGames).toHaveLength(0)
	})

	it('detects missing image as critical', () => {
		const rows = [{ ...base, imagePath: null, description: 'Some desc', videoPath: null }]
		const health = computeCollectionHealth(rows)
		expect(health.missingMedia).toBe(1)
		expect(health.unscrapedGames[0]!.missingImage).toBe(true)
		expect(health.unscrapedGames[0]!.missingDescription).toBe(false)
	})

	it('detects missing description as critical', () => {
		const rows = [{ ...base, imagePath: '/img.png', description: null, videoPath: null }]
		const health = computeCollectionHealth(rows)
		expect(health.missingMedia).toBe(1)
		expect(health.unscrapedGames[0]!.missingImage).toBe(false)
		expect(health.unscrapedGames[0]!.missingDescription).toBe(true)
	})

	it('missing video does NOT count as critical missing media', () => {
		const rows = [
			{ ...base, imagePath: '/img.png', description: 'A game', videoPath: null },
		]
		const health = computeCollectionHealth(rows)
		expect(health.missingMedia).toBe(0)
		expect(health.fullyScraped).toBe(1)
		expect(health.unscrapedGames).toHaveLength(0)
	})

	it('tracks missing video on unscraped games (informational)', () => {
		const rows = [
			{ ...base, imagePath: null, description: null, videoPath: null },
		]
		const health = computeCollectionHealth(rows)
		expect(health.unscrapedGames[0]!.missingVideo).toBe(true)
	})

	it('aggregates bySystem correctly', () => {
		const rows = [
			{ ...base, system: 'psx', imagePath: null, description: null, videoPath: null },
			{ ...base, system: 'psx', name: 'G2', imagePath: '/img.png', description: 'ok', videoPath: null },
			{ ...base, system: 'saturn', imagePath: null, description: 'ok', videoPath: null },
		]
		const health = computeCollectionHealth(rows)
		const psx = health.bySystem.find((s) => s.system === 'psx')
		const saturn = health.bySystem.find((s) => s.system === 'saturn')
		expect(psx?.total).toBe(2)
		expect(psx?.missingMedia).toBe(1)
		expect(saturn?.total).toBe(1)
		expect(saturn?.missingMedia).toBe(1)
	})

	it('100% scraped collection → missingMedia = 0', () => {
		const rows = [
			{ ...base, imagePath: '/a.png', description: 'A', videoPath: '/a.mp4' },
			{ ...base, name: 'B', imagePath: '/b.png', description: 'B', videoPath: null },
		]
		const health = computeCollectionHealth(rows)
		expect(health.missingMedia).toBe(0)
		expect(health.fullyScraped).toBe(2)
	})

	it('empty collection returns zeros', () => {
		const health = computeCollectionHealth([])
		expect(health.totalGames).toBe(0)
		expect(health.missingMedia).toBe(0)
		expect(health.fullyScraped).toBe(0)
		expect(health.bySystem).toHaveLength(0)
	})
})
