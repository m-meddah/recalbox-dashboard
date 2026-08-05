import type { GameStartEvent } from '@/lib/recalbox/events'
import { describe, expect, it } from 'vitest'
import { type SeedState, initialStream, seedToStream } from '../seed-state'

const game: GameStartEvent = {
	type: 'game:start',
	system: 'snes',
	systemFullName: 'Super Nintendo',
	gameName: 'Chrono Trigger',
	romPath: '/roms/snes/ct.zip',
	startedAt: new Date('2026-08-05T10:00:00Z'),
}

describe('seedToStream', () => {
	it('retourne l\'état vide quand il n\'y a pas de seed', () => {
		expect(seedToStream(null)).toEqual(initialStream)
	})

	it('reporte la box, le jeu et l\'état en ligne', () => {
		const seed: SeedState = {
			box: 'rb-1',
			game,
			online: true,
			lastSeenAt: new Date('2026-08-05T10:01:00Z'),
		}
		const stream = seedToStream(seed)
		expect(stream.box).toBe('rb-1')
		expect(stream.mqttOnline).toBe(true)
		expect(stream.activity.game).toEqual(game)
	})

	it('laisse null les signaux absents en serverless', () => {
		const seed: SeedState = { box: 'rb-1', game: null, online: false, lastSeenAt: null }
		const stream = seedToStream(seed)
		expect(stream.activity.game).toBeNull()
		expect(stream.activity.browsing).toBeNull()
		expect(stream.activity.lastSystemInfo).toBeNull()
		expect(stream.activity.screensaver).toBe(false)
		expect(stream.mqttOnline).toBe(false)
	})

	it('mqttOnline vaut false — jamais null — dès qu\'un seed existe', () => {
		// null signifie « en cours de chargement » côté UI et laisse les composants
		// en squelette perpétuel. Un seed est une réponse, pas une attente.
		const seed: SeedState = { box: 'rb-1', game: null, online: false, lastSeenAt: null }
		expect(seedToStream(seed).mqttOnline).not.toBeNull()
	})
})
