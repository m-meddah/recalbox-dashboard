import { describe, expect, it } from 'vitest'
import { gameIdentityKey } from '../game-identity'

describe('gameIdentityKey', () => {
	it('prefers the IGDB id when the row is matched', () => {
		expect(gameIdentityKey({ igdbId: 1234, name: 'Metal Slug (Japan)' })).toBe('igdb:1234')
	})

	it('collapses the same game across emulators and regions', () => {
		// The exact case behind the bug: one arcade board, two emulator folders,
		// EmulationStation hearts only one of the rows.
		const neogeo = gameIdentityKey({ igdbId: 77, name: 'Top Hunter: Roddy & Cathy' })
		const fbneo = gameIdentityKey({ igdbId: 77, name: 'Top Hunter: Roddy & Cathy (Japan)' })
		expect(neogeo).toBe(fbneo)
	})

	it('falls back to the canonical title when unmatched', () => {
		const usa = gameIdentityKey({ igdbId: null, name: 'Super Metroid (USA)' })
		const europe = gameIdentityKey({ igdbId: null, name: 'Super Metroid (Europe) (Rev 1)' })
		expect(usa).toBe(europe)
		expect(usa).toBe('title:super metroid')
	})

	it('folds casing, accents and spaced punctuation in the fallback', () => {
		const spaced = gameIdentityKey({
			igdbId: null,
			name: 'The Legend of Zelda : A Link to the Past',
		})
		const tight = gameIdentityKey({
			igdbId: null,
			name: 'The Legend of Zelda: A Link to the Past',
		})
		expect(spaced).toBe(tight)
		expect(gameIdentityKey({ igdbId: null, name: 'Pokémon Rouge' })).toBe('title:pokemon rouge')
	})

	it('keeps genuinely different games apart', () => {
		expect(gameIdentityKey({ igdbId: null, name: 'Aladdin' })).not.toBe(
			gameIdentityKey({ igdbId: null, name: 'Aladdin 2' }),
		)
		expect(gameIdentityKey({ igdbId: 1, name: 'Aladdin' })).not.toBe(
			gameIdentityKey({ igdbId: 2, name: 'Aladdin' }),
		)
	})

	it('keeps the matched and unmatched namespaces separate', () => {
		// Merging them would need a title lookup per IGDB id; getting it wrong
		// silently hides a game from every recommendation.
		expect(gameIdentityKey({ igdbId: 5, name: 'Contra' })).not.toBe(
			gameIdentityKey({ igdbId: null, name: 'Contra' }),
		)
	})
})
