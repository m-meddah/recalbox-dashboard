import { describe, expect, it } from 'vitest'
import { SuperRetrogamersClient } from '../client'

describe('SuperRetrogamersClient (mock mode)', () => {
	const client = new SuperRetrogamersClient()

	it('checkExists always returns { exists: false }', async () => {
		const result = await client.checkExists('super-mario-world-console-super-nintendo')
		expect(result).toEqual({ exists: false })
	})

	it('getGame always returns null', async () => {
		const result = await client.getGame('super-mario-world-console-super-nintendo')
		expect(result).toBeNull()
	})

	it('bulkLookup returns empty record', async () => {
		const result = await client.bulkLookup([
			'super-mario-world-console-super-nintendo',
			'mega-man-7-console-super-nintendo',
		])
		expect(result).toEqual({})
	})

	it('listSystems returns empty array', async () => {
		const result = await client.listSystems()
		expect(result).toEqual([])
	})

	it('checkExists never throws', async () => {
		await expect(client.checkExists('')).resolves.not.toThrow()
	})
})
