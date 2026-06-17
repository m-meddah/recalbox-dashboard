import type { AppConfig } from '@/lib/settings/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getConfig = vi.fn<() => AppConfig>()
vi.mock('@/lib/config-store', () => ({
	configStore: { get: () => getConfig() },
}))

const getCachedStale = vi.fn()
const setCached = vi.fn()
vi.mock('../cache', () => ({
	getCachedStale: (key: string) => getCachedStale(key),
	setCached: (key: string, value: unknown) => setCached(key, value),
}))

import { SuperRetrogamersClient } from '../client'

type SrCfg = Partial<AppConfig['superRetrogamers']>

function configure(over: SrCfg = {}) {
	getConfig.mockReturnValue({
		superRetrogamers: {
			enabled: true,
			apiUrl: 'https://api.test/api/v1',
			apiKey: 'SECRET-KEY',
			preferredRegion: '',
			...over,
		},
	} as AppConfig)
}

function jsonResponse(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	} as Response
}

type FetchInit = { headers: Record<string, string>; signal: unknown }
const fetchMock = vi.fn<(url: string, init: FetchInit) => Promise<Response>>()

function firstCall(): [string, FetchInit] {
	const call = fetchMock.mock.calls[0]
	if (!call) throw new Error('fetch was not called')
	return call
}

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock)
	fetchMock.mockReset()
	getCachedStale.mockReset().mockReturnValue(null)
	setCached.mockReset()
	getConfig.mockReset()
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('SuperRetrogamersClient — disabled / no-op', () => {
	it('enabled=false is a no-op (no fetch) matching the stub contract', async () => {
		configure({ enabled: false })
		const client = new SuperRetrogamersClient()
		expect(await client.checkExists('a-console-nes')).toEqual({ exists: false })
		expect(await client.getGame('a-console-nes')).toBeNull()
		expect(await client.bulkLookup(['a-console-nes'])).toEqual({})
		expect(await client.listSystems()).toEqual([])
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('empty apiUrl is a no-op (no fetch)', async () => {
		configure({ apiUrl: '' })
		const client = new SuperRetrogamersClient()
		expect(await client.getGame('a-console-nes')).toBeNull()
		expect(await client.listSystems()).toEqual([])
		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe('SuperRetrogamersClient — enabled', () => {
	const game = {
		slug: 'super-mario-world-console-super-nintendo',
		name: 'Super Mario World',
		consoleSlug: 'super-nintendo',
		score: 92,
		summary: 'A platformer.',
		specs: { players: '1-2' },
		characters: [],
		releaseDate: '1990-11-21',
		url: 'https://www.super-retrogamers.com/games/super-mario-world-console-super-nintendo',
	}

	it('getGame fetches the game endpoint with auth header and User-Agent', async () => {
		configure()
		fetchMock.mockResolvedValue(jsonResponse(game))
		const client = new SuperRetrogamersClient()
		const result = await client.getGame('super-mario-world-console-super-nintendo')

		expect(result).toEqual({ ...game, characters: [] })
		expect(result?.releaseDate).toBe('1990-11-21')
		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = firstCall()
		expect(url).toBe('https://api.test/api/v1/games/super-mario-world-console-super-nintendo')
		expect(init.headers['X-API-Key']).toBe('SECRET-KEY')
		expect(init.headers['User-Agent']).toMatch(/recalbox-dashboard/i)
		expect(init.signal).toBeDefined()
	})

	it('getGame applies preferredRegion as a query param', async () => {
		configure({ preferredRegion: 'US' })
		fetchMock.mockResolvedValue(jsonResponse(game))
		const client = new SuperRetrogamersClient()
		await client.getGame('super-mario-world-console-super-nintendo')
		const [url] = firstCall()
		expect(url).toBe(
			'https://api.test/api/v1/games/super-mario-world-console-super-nintendo?region=US',
		)
	})

	it('getGame prefers the mapped ROM region over preferredRegion', async () => {
		configure({ preferredRegion: 'US' })
		fetchMock.mockResolvedValue(jsonResponse(game))
		const client = new SuperRetrogamersClient()
		await client.getGame('super-mario-world-console-super-nintendo', 'jp,us')
		const [url] = firstCall()
		expect(url).toBe(
			'https://api.test/api/v1/games/super-mario-world-console-super-nintendo?region=JP',
		)
	})

	it('getGame falls back to preferredRegion when the ROM region does not map', async () => {
		configure({ preferredRegion: 'EU' })
		fetchMock.mockResolvedValue(jsonResponse(game))
		const client = new SuperRetrogamersClient()
		await client.getGame('super-mario-world-console-super-nintendo', 'de')
		const [url] = firstCall()
		expect(url).toBe(
			'https://api.test/api/v1/games/super-mario-world-console-super-nintendo?region=EU',
		)
	})

	it('getGame caches per resolved region', async () => {
		configure({ preferredRegion: '' })
		fetchMock.mockResolvedValue(jsonResponse(game))
		const client = new SuperRetrogamersClient()
		await client.getGame('super-mario-world-console-super-nintendo', 'us')
		expect(setCached).toHaveBeenCalledWith(
			'game:super-mario-world-console-super-nintendo:US',
			expect.objectContaining({ slug: game.slug }),
		)
	})

	it('getGame returns null on 404 and caches successful lookups under the default region', async () => {
		configure()
		fetchMock.mockResolvedValueOnce(jsonResponse(game))
		const client = new SuperRetrogamersClient()
		await client.getGame('super-mario-world-console-super-nintendo')
		expect(setCached).toHaveBeenCalledWith(
			'game:super-mario-world-console-super-nintendo:FR',
			expect.objectContaining({ slug: game.slug }),
		)

		fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Game not found' }, 404))
		expect(await client.getGame('missing-console-nes')).toBeNull()
	})

	it('getGame returns a fresh cached value without fetching', async () => {
		configure()
		getCachedStale.mockReturnValue({ value: { ...game, characters: [] }, stale: false })
		const client = new SuperRetrogamersClient()
		const result = await client.getGame('super-mario-world-console-super-nintendo')
		expect(result).toEqual({ ...game, characters: [] })
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('listSystems fetches systems, maps them, and caches', async () => {
		configure({ preferredRegion: 'EU' })
		fetchMock.mockResolvedValue(
			jsonResponse([
				{ slug: 'super-nintendo', name: 'Super Nintendo' },
				{ slug: 'nes', name: 'NES' },
			]),
		)
		const client = new SuperRetrogamersClient()
		const systems = await client.listSystems()
		expect(systems).toEqual([
			{ slug: 'super-nintendo', name: 'Super Nintendo' },
			{ slug: 'nes', name: 'NES' },
		])
		const [url] = firstCall()
		expect(url).toBe('https://api.test/api/v1/systems?region=EU')
		expect(setCached).toHaveBeenCalledWith('systems:EU', systems)
	})

	it('checkExists queries the exists endpoint for the single slug', async () => {
		configure()
		fetchMock.mockResolvedValue(
			jsonResponse({
				'a-console-nes': {
					exists: true,
					url: 'https://www.super-retrogamers.com/games/a-console-nes',
				},
			}),
		)
		const client = new SuperRetrogamersClient()
		const result = await client.checkExists('a-console-nes')
		expect(result).toEqual({
			exists: true,
			url: 'https://www.super-retrogamers.com/games/a-console-nes',
		})
		const [url] = firstCall()
		expect(url).toBe('https://api.test/api/v1/games/exists?slugs=a-console-nes')
	})

	it('bulkLookup queries the exists endpoint once with comma-joined slugs', async () => {
		configure()
		fetchMock.mockResolvedValue(
			jsonResponse({
				'a-console-nes': {
					exists: true,
					url: 'https://www.super-retrogamers.com/games/a-console-nes',
				},
				'b-console-nes': { exists: false },
			}),
		)
		const client = new SuperRetrogamersClient()
		const result = await client.bulkLookup(['a-console-nes', 'b-console-nes'])
		expect(result).toEqual({
			'a-console-nes': {
				exists: true,
				url: 'https://www.super-retrogamers.com/games/a-console-nes',
			},
			'b-console-nes': { exists: false },
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url] = firstCall()
		expect(url).toBe('https://api.test/api/v1/games/exists?slugs=a-console-nes%2Cb-console-nes')
	})
})

describe('SuperRetrogamersClient — never throws', () => {
	beforeEach(() => {
		configure()
		vi.spyOn(console, 'warn').mockImplementation(() => {})
	})

	it('checkExists never throws and falls back to exists:false on network error', async () => {
		fetchMock.mockRejectedValue(new Error('network down'))
		const client = new SuperRetrogamersClient()
		await expect(client.checkExists('a-console-nes')).resolves.toEqual({ exists: false })
	})

	it('checkExists never throws on empty input', async () => {
		const client = new SuperRetrogamersClient()
		await expect(client.checkExists('')).resolves.not.toThrow()
	})

	it('getGame falls back to null on HTTP 401', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401))
		const client = new SuperRetrogamersClient()
		expect(await client.getGame('a-console-nes')).toBeNull()
	})

	it('listSystems falls back to [] on error', async () => {
		fetchMock.mockRejectedValue(new Error('boom'))
		const client = new SuperRetrogamersClient()
		expect(await client.listSystems()).toEqual([])
	})

	it('bulkLookup falls back to exists:false per slug on error', async () => {
		fetchMock.mockRejectedValue(new Error('boom'))
		const client = new SuperRetrogamersClient()
		expect(await client.bulkLookup(['a-console-nes', 'b-console-nes'])).toEqual({
			'a-console-nes': { exists: false },
			'b-console-nes': { exists: false },
		})
	})
})
