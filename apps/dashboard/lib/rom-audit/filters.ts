import type { MissingFilters } from './match'

/**
 * Builds the missing-list filters from a query string.
 *
 * Categories are lower-cased on the way in: the tag parser emits them
 * lower-case ('proto', 'beta'), so `?exclude=Proto` would otherwise match
 * nothing at all — and silently, which is the worst kind of filter bug. Regions
 * keep their case, because the DAT vocabulary is capitalised ('USA', 'Europe').
 */
export function missingFiltersFrom(params: URLSearchParams): MissingFilters | undefined {
	const regions = params
		.getAll('region')
		.flatMap((v) => v.split(','))
		.map((v) => v.trim())
		.filter(Boolean)
	const excludeCategories = params
		.getAll('exclude')
		.flatMap((v) => v.split(','))
		.map((v) => v.trim().toLowerCase())
		.filter(Boolean)

	if (regions.length === 0 && excludeCategories.length === 0) return undefined
	return {
		...(regions.length ? { regions } : {}),
		...(excludeCategories.length ? { excludeCategories } : {}),
	}
}
