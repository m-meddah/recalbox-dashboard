import { getAccessToken } from './auth'

const IGDB_BASE_URL = 'https://api.igdb.com/v4'
const MAX_REQUESTS_PER_SECOND = 4

class RateLimiter {
	private timestamps: number[] = []

	async acquire(): Promise<void> {
		const now = Date.now()
		this.timestamps = this.timestamps.filter((t) => now - t < 1000)

		if (this.timestamps.length >= MAX_REQUESTS_PER_SECOND) {
			const oldest = this.timestamps[0] ?? now
			const waitMs = 1000 - (now - oldest) + 50
			await new Promise((r) => setTimeout(r, waitMs))
			return this.acquire()
		}

		this.timestamps.push(Date.now())
	}
}

const rateLimiter = new RateLimiter()

export type IgdbClientError =
	| { type: 'auth_error' }
	| { type: 'rate_limited' }
	| { type: 'http_error'; status: number; body: string }
	| { type: 'network_error'; message: string }

export type IgdbResponse<T> = { ok: true; data: T } | { ok: false; error: IgdbClientError }

export async function igdbQuery<T>(
	endpoint: string,
	apicalypseQuery: string,
): Promise<IgdbResponse<T>> {
	const auth = await getAccessToken()
	if (!auth.ok) return { ok: false, error: { type: 'auth_error' } }

	await rateLimiter.acquire()

	try {
		const res = await fetch(`${IGDB_BASE_URL}/${endpoint}`, {
			method: 'POST',
			headers: {
				'Client-ID': auth.clientId,
				Authorization: `Bearer ${auth.token}`,
				Accept: 'application/json',
				'Content-Type': 'text/plain',
			},
			body: apicalypseQuery,
		})

		if (res.status === 429) return { ok: false, error: { type: 'rate_limited' } }

		if (!res.ok) {
			const body = await res.text()
			return { ok: false, error: { type: 'http_error', status: res.status, body } }
		}

		const data = (await res.json()) as T
		return { ok: true, data }
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : 'unknown'
		return { ok: false, error: { type: 'network_error', message } }
	}
}
