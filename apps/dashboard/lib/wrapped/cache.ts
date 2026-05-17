import { db } from '@/lib/db/index'
import { wrappedCache } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { generateWrapped } from './generator'
import type { Wrapped } from './types'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function isCacheStale(generatedAt: Date, year: number): boolean {
	const currentYear = new Date().getFullYear()
	if (year < currentYear) return false
	return Date.now() - generatedAt.getTime() > CACHE_TTL_MS
}

export async function getCachedWrapped(year: number, locale: string): Promise<Wrapped | null> {
	const row = db
		.select()
		.from(wrappedCache)
		.where(and(eq(wrappedCache.year, year), eq(wrappedCache.locale, locale)))
		.get()

	if (row && !isCacheStale(row.generatedAt, year)) {
		return JSON.parse(row.data, (key, value) => {
			if (key === 'generatedAt' && typeof value === 'string') return new Date(value)
			if (key === 'startedAt' && typeof value === 'string') return new Date(value)
			return value
		}) as Wrapped
	}

	const wrapped = await generateWrapped(year, locale)
	await writeCachedWrapped(wrapped, locale)
	return wrapped
}

export async function writeCachedWrapped(wrapped: Wrapped, locale: string): Promise<void> {
	db.insert(wrappedCache)
		.values({
			year: wrapped.year,
			locale,
			data: JSON.stringify(wrapped),
			generatedAt: wrapped.generatedAt,
		})
		.onConflictDoUpdate({
			target: [wrappedCache.year, wrappedCache.locale],
			set: {
				data: JSON.stringify(wrapped),
				generatedAt: wrapped.generatedAt,
			},
		})
		.run()
}

export async function invalidateWrappedCache(year: number, locale: string): Promise<void> {
	db.delete(wrappedCache)
		.where(and(eq(wrappedCache.year, year), eq(wrappedCache.locale, locale)))
		.run()
}
