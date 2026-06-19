import { configStore } from '@/lib/config-store'
import type { SuperRetrogamersConfig } from '@/lib/settings/schemas'
import { getCachedStale, setCached } from './cache'
import { mapExists, mapSrGame, mapSrSystems } from './mapping'
import { resolveRegion } from './region'

export type SrGame = {
	slug: string
	name: string
	consoleSlug: string
	score: number | null
	summary: string | null
	specs: Record<string, string>
	characters: string[]
	releaseDate: string | null
	url: string
}

export type SrSystem = {
	slug: string
	name: string
}

export type BulkLookupResult = Record<string, { exists: boolean; url?: string }>

const REQUEST_TIMEOUT_MS = 10_000
const USER_AGENT = 'recalbox-dashboard/1.0 (+https://github.com/m-meddah/recalbox-dashboard)'

export class SuperRetrogamersClient {
	private config(): SuperRetrogamersConfig {
		return configStore.get().superRetrogamers
	}

	private isEnabled(cfg: SuperRetrogamersConfig): boolean {
		return cfg.enabled && cfg.apiUrl.trim().length > 0
	}

	private baseUrl(cfg: SuperRetrogamersConfig): string {
		return cfg.apiUrl.trim().replace(/\/+$/, '')
	}

	private regionQuery(region: string): string {
		return region ? `?region=${region}` : ''
	}

	/** Perform a GET and parse JSON. Returns null on any network/HTTP error (never throws). */
	private async request(url: string, apiKey: string): Promise<unknown | null> {
		try {
			const res = await fetch(url, {
				headers: {
					'X-API-Key': apiKey,
					'User-Agent': USER_AGENT,
					Accept: 'application/json',
				},
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			})
			if (!res.ok) {
				return null
			}
			return await res.json()
		} catch (err) {
			console.warn(`[super-retrogamers] request failed for ${url}:`, err)
			return null
		}
	}

	async checkExists(slug: string): Promise<{ exists: boolean; url?: string }> {
		const result = await this.bulkLookup([slug])
		return result[slug] ?? { exists: false }
	}

	async getGame(slug: string, romRegion?: string): Promise<SrGame | null> {
		const cfg = this.config()
		if (!this.isEnabled(cfg)) return null

		const region = resolveRegion(romRegion, cfg.preferredRegion)
		// Same slug yields different data per region, so the region is part of the key.
		const cacheKey = `game:${slug}:${region || 'FR'}`
		const cached = await getCachedStale<SrGame>(cacheKey)
		if (cached && !cached.stale) return cached.value

		const url = `${this.baseUrl(cfg)}/games/${encodeURIComponent(slug)}${this.regionQuery(region)}`
		const json = await this.request(url, cfg.apiKey)
		const game = mapSrGame(json)
		if (game) await setCached(cacheKey, game)
		return game
	}

	async bulkLookup(slugs: string[]): Promise<BulkLookupResult> {
		const cfg = this.config()
		if (!this.isEnabled(cfg) || slugs.length === 0) return {}

		const result: BulkLookupResult = {}
		const uncached: string[] = []
		for (const slug of slugs) {
			const cached = await getCachedStale<{ exists: boolean; url?: string } | boolean>(
				`exists:${slug}`,
			)
			if (cached && !cached.stale) {
				result[slug] = normaliseExistsEntry(cached.value)
			} else {
				uncached.push(slug)
			}
		}
		if (uncached.length === 0) return result

		const fetched = await this.queryExists(uncached, cfg)
		for (const slug of uncached) {
			const entry = fetched?.[slug] ?? { exists: false }
			result[slug] = entry
			// Only persist results from a successful query, never a transient failure.
			if (fetched) await setCached(`exists:${slug}`, entry)
		}
		return result
	}

	async listSystems(): Promise<SrSystem[]> {
		const cfg = this.config()
		if (!this.isEnabled(cfg)) return []

		const region = cfg.preferredRegion || 'FR'
		const cacheKey = `systems:${region}`
		const cached = await getCachedStale<SrSystem[]>(cacheKey)
		if (cached && !cached.stale) return cached.value

		const url = `${this.baseUrl(cfg)}/systems${this.regionQuery(cfg.preferredRegion)}`
		const json = await this.request(url, cfg.apiKey)
		if (json === null) return []
		const systems = mapSrSystems(json)
		await setCached(cacheKey, systems)
		return systems
	}

	/** Query the exists endpoint. Returns null on request failure (so callers can fall back). */
	private async queryExists(
		slugs: string[],
		cfg: SuperRetrogamersConfig,
	): Promise<BulkLookupResult | null> {
		const params = new URLSearchParams({ slugs: slugs.join(',') })
		const url = `${this.baseUrl(cfg)}/games/exists?${params.toString()}`
		const json = await this.request(url, cfg.apiKey)
		if (json === null) return null
		return mapExists(json)
	}
}

function normaliseExistsEntry(value: { exists: boolean; url?: string } | boolean): {
	exists: boolean
	url?: string
} {
	if (typeof value === 'boolean') return { exists: value }
	return value.url ? { exists: value.exists, url: value.url } : { exists: value.exists }
}

export const srClient = new SuperRetrogamersClient()
