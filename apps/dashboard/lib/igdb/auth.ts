import { db } from '@/lib/db'
import { igdbCredentials } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const REFRESH_BUFFER_MS = 5 * 60 * 1000

export type IgdbAuthError =
	| { type: 'no_credentials' }
	| { type: 'invalid_credentials' }
	| { type: 'network_error'; message: string }
	| { type: 'disabled' }

export async function isIgdbEnabled(): Promise<boolean> {
	const creds = await db
		.select({ enabled: igdbCredentials.enabled })
		.from(igdbCredentials)
		.where(eq(igdbCredentials.id, 1))
		.get()
	return creds?.enabled ?? false
}

export async function getAccessToken(): Promise<
	{ ok: true; token: string; clientId: string } | { ok: false; error: IgdbAuthError }
> {
	const creds = await db.select().from(igdbCredentials).where(eq(igdbCredentials.id, 1)).get()

	if (!creds) return { ok: false, error: { type: 'no_credentials' } }
	if (!creds.enabled) return { ok: false, error: { type: 'disabled' } }
	if (!creds.clientId || !creds.clientSecret) {
		return { ok: false, error: { type: 'no_credentials' } }
	}

	const now = Date.now()
	const expiresAt = creds.accessTokenExpiresAt?.getTime() ?? 0

	if (creds.accessToken && expiresAt > now + REFRESH_BUFFER_MS) {
		return { ok: true, token: creds.accessToken, clientId: creds.clientId }
	}

	return refreshAccessToken(creds.clientId, creds.clientSecret)
}

async function refreshAccessToken(
	clientId: string,
	clientSecret: string,
): Promise<{ ok: true; token: string; clientId: string } | { ok: false; error: IgdbAuthError }> {
	try {
		const url = new URL(TWITCH_TOKEN_URL)
		url.searchParams.set('client_id', clientId)
		url.searchParams.set('client_secret', clientSecret)
		url.searchParams.set('grant_type', 'client_credentials')

		const res = await fetch(url, { method: 'POST' })

		if (res.status === 400 || res.status === 403) {
			await db
				.update(igdbCredentials)
				.set({ lastTestStatus: 'invalid_credentials', lastTestedAt: new Date() })
				.where(eq(igdbCredentials.id, 1))
			return { ok: false, error: { type: 'invalid_credentials' } }
		}

		if (!res.ok) {
			return { ok: false, error: { type: 'network_error', message: `HTTP ${res.status}` } }
		}

		const data = (await res.json()) as { access_token: string; expires_in: number }
		const expiresAt = new Date(Date.now() + data.expires_in * 1000)

		await db
			.update(igdbCredentials)
			.set({
				accessToken: data.access_token,
				accessTokenExpiresAt: expiresAt,
				lastTestStatus: 'ok',
				lastTestedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(igdbCredentials.id, 1))

		return { ok: true, token: data.access_token, clientId }
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : 'unknown'
		return { ok: false, error: { type: 'network_error', message } }
	}
}

export async function saveAndTestCredentials(
	clientId: string,
	clientSecret: string,
): Promise<{ ok: true } | { ok: false; error: IgdbAuthError }> {
	await db
		.update(igdbCredentials)
		.set({ clientId, clientSecret, updatedAt: new Date() })
		.where(eq(igdbCredentials.id, 1))

	const result = await refreshAccessToken(clientId, clientSecret)

	if (result.ok) {
		await db.update(igdbCredentials).set({ enabled: true }).where(eq(igdbCredentials.id, 1))
		return { ok: true }
	}

	return result
}
