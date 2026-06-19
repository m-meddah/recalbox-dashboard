import { db } from '@/lib/db'
import { srCache } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const TTL_MS = {
	exists: 24 * 60 * 60 * 1000,
	game: 12 * 60 * 60 * 1000,
	systems: 7 * 24 * 60 * 60 * 1000,
} as const

function ttlFor(key: string): number {
	if (key.startsWith('exists:')) return TTL_MS.exists
	if (key.startsWith('game:')) return TTL_MS.game
	return TTL_MS.systems
}

async function getCached<T>(key: string): Promise<T | null> {
	const row = await db.select().from(srCache).where(eq(srCache.key, key)).get()
	if (!row) return null
	if (row.expiresAt < new Date()) {
		await db.delete(srCache).where(eq(srCache.key, key)).run()
		return null
	}
	try {
		return JSON.parse(row.value) as T
	} catch {
		return null
	}
}

export async function getCachedStale<T>(key: string): Promise<{ value: T; stale: boolean } | null> {
	const row = await db.select().from(srCache).where(eq(srCache.key, key)).get()
	if (!row) return null
	try {
		return { value: JSON.parse(row.value) as T, stale: row.expiresAt < new Date() }
	} catch {
		return null
	}
}

export async function setCached(key: string, value: unknown): Promise<void> {
	const expiresAt = new Date(Date.now() + ttlFor(key))
	await db
		.insert(srCache)
		.values({ key, value: JSON.stringify(value), expiresAt })
		.onConflictDoUpdate({
			target: srCache.key,
			set: { value: JSON.stringify(value), expiresAt },
		})
		.run()
}
