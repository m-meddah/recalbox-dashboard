import { z } from 'zod'
import type { BulkLookupResult, SrGame, SrSystem } from './client'

const srGameSchema = z.object({
	slug: z.string().min(1),
	name: z.string().min(1),
	consoleSlug: z.string().min(1),
	score: z
		.number()
		.nullish()
		.transform((v) => v ?? null),
	summary: z
		.string()
		.nullish()
		.transform((v) => v ?? null),
	specs: z
		.record(z.string(), z.string())
		.nullish()
		.transform((v) => v ?? {}),
	releaseDate: z
		.string()
		.nullish()
		.transform((v) => v ?? null),
	url: z.string().min(1),
})

const srSystemSchema = z.object({
	slug: z.string().min(1),
	name: z.string().min(1),
})

const existsEntrySchema = z.object({
	exists: z.boolean(),
	url: z.string().optional(),
})

/** Map a raw API game object into an SrGame, or null when it is malformed. */
export function mapSrGame(raw: unknown): SrGame | null {
	const parsed = srGameSchema.safeParse(raw)
	if (!parsed.success) return null
	// `characters` is always empty: the API schema has no character relation.
	return { ...parsed.data, characters: [] }
}

/** Map a raw API systems list into SrSystem[], dropping malformed entries. */
export function mapSrSystems(raw: unknown): SrSystem[] {
	if (!Array.isArray(raw)) return []
	const systems: SrSystem[] = []
	for (const entry of raw) {
		const parsed = srSystemSchema.safeParse(entry)
		if (parsed.success) systems.push(parsed.data)
	}
	return systems
}

/** Map a raw API exists response into BulkLookupResult; malformed → exists: false. */
export function mapExists(raw: unknown): BulkLookupResult {
	if (!raw || typeof raw !== 'object') return {}
	const result: BulkLookupResult = {}
	for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
		const parsed = existsEntrySchema.safeParse(value)
		result[slug] = parsed.success
			? parsed.data.url
				? { exists: parsed.data.exists, url: parsed.data.url }
				: { exists: parsed.data.exists }
			: { exists: false }
	}
	return result
}
