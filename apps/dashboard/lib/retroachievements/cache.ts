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

export async function getCached<T>(key: string): Promise<T | null> {
	const row = await db.select().from(raCache).where(eq(raCache.key, key)).get()
	if (!row) return null
	if (row.expiresAt < new Date()) {
		await db.delete(raCache).where(eq(raCache.key, key)).run()
		return null
	}
	try {
		return JSON.parse(row.value) as T
	} catch {
		return null
	}
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
	const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
	const serialized = JSON.stringify(value)
	await db
		.insert(raCache)
		.values({ key, value: serialized, expiresAt })
		.onConflictDoUpdate({ target: raCache.key, set: { value: serialized, expiresAt } })
		.run()
}

async function invalidateCacheByPrefix(keyPrefix: string): Promise<void> {
	await db
		.delete(raCache)
		.where(like(raCache.key, `${keyPrefix.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`))
		.run()
}

export async function purgeExpiredCache(): Promise<void> {
	await db.delete(raCache).where(lt(raCache.expiresAt, new Date())).run()
}
