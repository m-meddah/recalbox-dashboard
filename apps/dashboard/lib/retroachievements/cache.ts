import { db } from '@/lib/db'
import { raCache } from '@/lib/db/schema'
import { eq, like, lt } from 'drizzle-orm'

const TTL: Record<string, number> = {
	userProfile: 60 * 60,
	recentAchievements: 5 * 60,
	gameProgress: 30 * 60,
	gameMetadata: 24 * 60 * 60,
}

export function getTtlSeconds(kind: keyof typeof TTL): number {
	return TTL[kind] ?? 60 * 60
}

export function getCached<T>(key: string): T | null {
	const row = db.select().from(raCache).where(eq(raCache.key, key)).get()
	if (!row) return null
	if (row.expiresAt < new Date()) {
		db.delete(raCache).where(eq(raCache.key, key)).run()
		return null
	}
	try {
		return JSON.parse(row.value) as T
	} catch {
		return null
	}
}

export function setCached<T>(key: string, value: T, ttlSeconds: number): void {
	const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
	const serialized = JSON.stringify(value)
	db.insert(raCache)
		.values({ key, value: serialized, expiresAt })
		.onConflictDoUpdate({ target: raCache.key, set: { value: serialized, expiresAt } })
		.run()
}

export function invalidateCacheByPrefix(keyPrefix: string): void {
	db.delete(raCache)
		.where(like(raCache.key, `${keyPrefix.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`))
		.run()
}

export function purgeExpiredCache(): void {
	db.delete(raCache).where(lt(raCache.expiresAt, new Date())).run()
}
