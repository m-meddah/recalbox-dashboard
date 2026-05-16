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

export function getCached<T>(key: string): T | null {
	const row = db.select().from(srCache).where(eq(srCache.key, key)).get()
	if (!row) return null
	if (row.expiresAt < new Date()) return null
	try {
		return JSON.parse(row.value) as T
	} catch {
		return null
	}
}

export function getCachedStale<T>(key: string): { value: T; stale: boolean } | null {
	const row = db.select().from(srCache).where(eq(srCache.key, key)).get()
	if (!row) return null
	try {
		return { value: JSON.parse(row.value) as T, stale: row.expiresAt < new Date() }
	} catch {
		return null
	}
}

export function setCached(key: string, value: unknown): void {
	const expiresAt = new Date(Date.now() + ttlFor(key))
	db.insert(srCache)
		.values({ key, value: JSON.stringify(value), expiresAt })
		.onConflictDoUpdate({
			target: srCache.key,
			set: { value: JSON.stringify(value), expiresAt },
		})
		.run()
}
