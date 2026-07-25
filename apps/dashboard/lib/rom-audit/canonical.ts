export type NameTags = {
	regions: string[]
	languages: string[]
	categories: string[]
	// Broadcast standards (PAL/NTSC…) show up in the same trailing groups as
	// regions, and even mixed into the same comma list, but they are not a
	// geography — kept in their own field so a region filter (task 4) never
	// mistakes one for a place.
	broadcastStandards: string[]
	revision?: string
	disc?: number
}

const REGIONS = new Set([
	'Asia',
	'Australia',
	'Brazil',
	'Canada',
	'China',
	'Denmark',
	'Europe',
	'Finland',
	'France',
	'Germany',
	'Hong Kong',
	'Italy',
	'Japan',
	'Korea',
	'Netherlands',
	'Norway',
	'Poland',
	'Russia',
	'Spain',
	'Sweden',
	'Taiwan',
	'UK',
	'USA',
	'Unknown',
	'World',
])

// PAL is a broadcast standard, not a geography, but community/homebrew DATs
// use it interchangeably with a region tag — standalone (e.g. "Teenage Queen
// (PAL)") or stacked with real regions in one comma list (e.g. "(Europe,
// PAL)"). It must still be recognised so canonicalTitle strips it, but it
// must never land in NameTags.regions.
const BROADCAST_STANDARDS = new Set(['PAL'])

// (Proto), (Beta 2), (Demo)… → the canonical category slug. May also appear
// stacked as a comma list inside one group, e.g. "(Virtual Console, Switch Online)".
const CATEGORY_WORDS: Record<string, string> = {
	proto: 'proto',
	prototype: 'proto',
	beta: 'beta',
	demo: 'demo',
	sample: 'sample',
	alt: 'alt',
	unl: 'unl',
	unlicensed: 'unl',
	pirate: 'pirate',
	aftermarket: 'aftermarket',
	homebrew: 'homebrew',
	debug: 'debug',
	'virtual console': 'virtual-console',
	'switch online': 'switch-online',
	'classic mini': 'classic-mini',
}

const BRACKET_CATEGORY: Record<string, string> = {
	b: 'baddump',
	'!': 'verified',
	a: 'alt',
}

// Plain 2-letter codes ("En", "Fr") or extended BCP-47-ish ones with a region
// subtag ("Zh-Hans", "Zh-Hant"), as a single value or a comma list.
const LANG_LIST = /^[A-Z][a-z](?:-[A-Za-z]+)?(?:,[A-Z][a-z](?:-[A-Za-z]+)?)*$/
// No-Intro's "Rev 1" form, plus the dash form used by NES-conversion hacks
// in this DAT ("REV-B").
const REV = /^Rev(?:\s+|-)\S+$/i
const DISC = /^(?:Disc|Disk|Side|Tape)\s+(\S+)$/i
const VERSION = /^v[\d.]+$/i

type TrailingGroup = { group: string; bracket: boolean }

/** Splits a trailing "(…)" or "[…]" group off the end of a name. */
function splitTrailingGroup(
	name: string,
): { head: string; group: string; bracket: boolean } | null {
	const trimmed = name.trimEnd()
	const close = trimmed.at(-1)
	if (close !== ')' && close !== ']') return null
	const open = close === ')' ? '(' : '['
	let depth = 0
	for (let i = trimmed.length - 1; i >= 0; i--) {
		const ch = trimmed[i]
		if (ch === close) depth++
		else if (ch === open) {
			depth--
			if (depth === 0) {
				return {
					head: trimmed.slice(0, i).trimEnd(),
					group: trimmed.slice(i + 1, -1),
					bracket: close === ']',
				}
			}
		}
	}
	return null
}

function categorySlug(word: string): string | undefined {
	const base = word
		.trim()
		.replace(/\s+\d+$/, '')
		.toLowerCase()
	return CATEGORY_WORDS[base]
}

/** What a recognised trailing group is, and what it carries. */
type GroupTag =
	| { kind: 'bracket-category'; category: string }
	| { kind: 'revision'; revision: string }
	// A disc group with an unparseable number ("Disc A") is still a known tag —
	// it just has no number to report.
	| { kind: 'disc'; disc?: number }
	| { kind: 'version' }
	| { kind: 'languages'; languages: string[] }
	| { kind: 'regions'; regions: string[]; broadcastStandards: string[] }
	| { kind: 'categories'; categories: string[] }

/**
 * The single place a trailing group is classified. Everything downstream reads
 * this: `isKnownTag` is its non-nullity, `parseNameTags` its payload. Written
 * twice before, the two copies drifted apart and had to be fixed in lockstep.
 */
function classifyGroup(group: string, bracket: boolean): GroupTag | null {
	if (bracket) {
		const category = BRACKET_CATEGORY[group.toLowerCase()]
		return category ? { kind: 'bracket-category', category } : null
	}

	const g = group.trim()
	if (!g) return null
	if (REV.test(g)) return { kind: 'revision', revision: g }
	if (DISC.test(g)) {
		const n = Number(DISC.exec(g)?.[1])
		return { kind: 'disc', disc: Number.isFinite(n) ? n : undefined }
	}
	if (VERSION.test(g)) return { kind: 'version' }
	if (LANG_LIST.test(g)) return { kind: 'languages', languages: g.split(',') }

	const parts = g.split(',').map((part) => part.trim())
	if (parts.every((part) => REGIONS.has(part) || BROADCAST_STANDARDS.has(part))) {
		return {
			kind: 'regions',
			regions: parts.filter((part) => REGIONS.has(part)),
			broadcastStandards: parts.filter((part) => BROADCAST_STANDARDS.has(part)),
		}
	}

	const categories: string[] = []
	for (const part of parts) {
		const slug = categorySlug(part)
		if (!slug) return null
		categories.push(slug)
	}
	return { kind: 'categories', categories }
}

/** True when the group content is a tag we recognise, and may therefore be stripped. */
function isKnownTag(group: string, bracket: boolean): boolean {
	return classifyGroup(group, bracket) !== null
}

/**
 * Peels the maximal run of trailing "(…)"/"[…]" groups off the end of a name,
 * stopping as soon as what remains no longer ends in a parenthesised group —
 * that is what keeps the peel from ever eating into the real title. Groups
 * are returned in their original left-to-right order.
 */
function decompose(name: string): { base: string; groups: TrailingGroup[] } {
	const groups: TrailingGroup[] = []
	let current = name.trim()
	for (;;) {
		const split = splitTrailingGroup(current)
		if (!split) break
		groups.unshift({ group: split.group, bracket: split.bracket })
		current = split.head
	}
	return { base: current, groups }
}

function reassemble(base: string, groups: TrailingGroup[]): string {
	const tail = groups.map((g) => (g.bracket ? `[${g.group}]` : `(${g.group})`))
	return [base, ...tail].filter((part) => part.length > 0).join(' ')
}

/**
 * The DAT game name minus its recognised trailing metadata tags, wherever
 * among the trailing groups they sit — not just the last one. Groups that
 * are not part of the known vocabulary stay in the title, in place: splitting
 * one game in two is visible and fixable, merging two distinct games would
 * hide a missing entry. Two names that differ only by a known tag are, by
 * definition, the same game — so a known tag is dropped even when it sits
 * ahead of an unrecognised one (e.g. "Jeu (USA) (Golden Edition)").
 */
export function canonicalTitle(name: string): string {
	const { base, groups } = decompose(name)
	const kept = groups.filter((g) => !isKnownTag(g.group, g.bracket))
	const result = reassemble(base, kept)
	return result || name.trim()
}

export function parseNameTags(name: string): NameTags {
	const tags: NameTags = { regions: [], languages: [], categories: [], broadcastStandards: [] }
	const { groups } = decompose(name)

	for (const { group, bracket } of groups) {
		const tag = classifyGroup(group, bracket)
		if (!tag) continue

		switch (tag.kind) {
			case 'bracket-category':
				tags.categories.push(tag.category)
				break
			case 'revision':
				tags.revision = tag.revision
				break
			case 'disc':
				if (tag.disc !== undefined) tags.disc = tag.disc
				break
			case 'languages':
				tags.languages.push(...tag.languages)
				break
			case 'regions':
				tags.regions.push(...tag.regions)
				tags.broadcastStandards.push(...tag.broadcastStandards)
				break
			case 'categories':
				tags.categories.push(...tag.categories)
				break
			// A version group is recognised — so canonicalTitle strips it — but
			// carries nothing NameTags reports.
			case 'version':
				break
		}
	}
	return tags
}
