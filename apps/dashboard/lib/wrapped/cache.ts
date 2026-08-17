import { lookupArtworkUrls } from '@/lib/db/artwork'
import { db } from '@/lib/db/index'
import { wrappedCache } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { generateWrapped } from './generator'
import type { Wrapped } from './types'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Fill in cover images that were not mirrored yet when the recap was generated.
 *
 * Artwork is mirrored lazily: the very first view of a game asks the agent to upload its
 * cover, so it necessarily resolves to null right then, and the file lands a minute or two
 * later. Baking that null into a recap cached for 24h left a broken image for a whole day
 * on a file that was already available — resolving on read lets the recap heal itself.
 *
 * Read-only on purpose (`lookupArtworkUrls`, not `resolveArtworkUrls`): generation already
 * queued what was missing, and re-queuing on every page view would write a row each time
 * for a cover that may never exist — some systems simply have no image in the theme.
 */
async function withFreshArtwork(wrapped: Wrapped, recalboxIds: string[]): Promise<Wrapped> {
	const pending = wrapped.slides.flatMap((s) =>
		s.type === 'most-played-game' && s.imagePath && !s.imageUrl ? [s.imagePath] : [],
	)
	if (pending.length === 0 || recalboxIds.length === 0) return wrapped

	const urls = new Map<string, string>()
	for (const recalboxId of recalboxIds) {
		const found = await lookupArtworkUrls(db, recalboxId, pending).catch(
			() => new Map<string, string>(),
		)
		for (const [path, url] of found) if (!urls.has(path)) urls.set(path, url)
	}
	if (urls.size === 0) return wrapped

	return {
		...wrapped,
		slides: wrapped.slides.map((s) =>
			s.type === 'most-played-game' && s.imagePath && !s.imageUrl
				? { ...s, imageUrl: urls.get(s.imagePath) ?? null }
				: s,
		),
	}
}

/**
 * Cache key for a set of Recalboxes: their ids, sorted so the same set always yields the
 * same key regardless of the order they came back in.
 *
 * Keying on the box set rather than on the user is deliberate — the box set is what the
 * recap is actually computed from, so two accounts covering the same machines share an
 * entry correctly, and one covering different machines can never be served another's.
 */
export function wrappedScopeKey(recalboxIds: string[]): string {
	return [...recalboxIds].sort().join(',')
}

function isCacheStale(generatedAt: Date, year: number): boolean {
	const currentYear = new Date().getFullYear()
	if (year < currentYear) return false
	return Date.now() - generatedAt.getTime() > CACHE_TTL_MS
}

export async function getCachedWrapped(
	year: number,
	locale: string,
	recalboxIds: string[],
): Promise<Wrapped | null> {
	const scope = wrappedScopeKey(recalboxIds)
	const row = await db
		.select()
		.from(wrappedCache)
		.where(
			and(
				eq(wrappedCache.year, year),
				eq(wrappedCache.locale, locale),
				eq(wrappedCache.scope, scope),
			),
		)
		.get()

	if (row && !isCacheStale(row.generatedAt, year)) {
		const parsed = JSON.parse(row.data, (key, value) => {
			if (key === 'generatedAt' && typeof value === 'string') return new Date(value)
			if (key === 'startedAt' && typeof value === 'string') return new Date(value)
			return value
		}) as Wrapped
		const totalTimeSlide = parsed.slides.find((s) => s.type === 'total-time')
		if (!totalTimeSlide || 'totalMinutes' in totalTimeSlide) {
			return await withFreshArtwork(parsed, recalboxIds)
		}
		// stale shape — regenerate below
	}

	const wrapped = await generateWrapped(year, locale, recalboxIds)
	await writeCachedWrapped(wrapped, locale, recalboxIds)
	// A freshly generated recap has just queued its missing covers, so nothing to heal yet —
	// but go through the same path so both branches behave identically.
	return await withFreshArtwork(wrapped, recalboxIds)
}

export async function writeCachedWrapped(
	wrapped: Wrapped,
	locale: string,
	recalboxIds: string[],
): Promise<void> {
	const scope = wrappedScopeKey(recalboxIds)
	await db
		.insert(wrappedCache)
		.values({
			year: wrapped.year,
			locale,
			scope,
			data: JSON.stringify(wrapped),
			generatedAt: wrapped.generatedAt,
		})
		.onConflictDoUpdate({
			target: [wrappedCache.year, wrappedCache.locale, wrappedCache.scope],
			set: {
				data: JSON.stringify(wrapped),
				generatedAt: wrapped.generatedAt,
			},
		})
		.run()
}

export async function invalidateWrappedCache(
	year: number,
	locale: string,
	recalboxIds: string[],
): Promise<void> {
	await db
		.delete(wrappedCache)
		.where(
			and(
				eq(wrappedCache.year, year),
				eq(wrappedCache.locale, locale),
				eq(wrappedCache.scope, wrappedScopeKey(recalboxIds)),
			),
		)
		.run()
}
