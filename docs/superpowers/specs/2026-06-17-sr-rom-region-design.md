# Super Retrogamers — per-ROM-region data + `releaseDate`

Date: 2026-06-17
Branch: `feat/saas-multi-user`

## Goal

When showing a game's Super Retrogamers data, request it for the region of the
actual ROM (regional title / summary / release date) instead of a single global
preference. The SR API accepts six regions: `FR, EU, WOR, JP, US, ASI`.

Also reflect a contract update: the `getGame` response now carries
`releaseDate: string | null` (`"YYYY-MM-DD"`, region-dependent, `null` when no
regional date).

## Background

- ROMs carry `region` (`games.region`, from the gamelist `<region>` tag) — these
  are ScreenScraper codes (`wor`, `eu`, `us`, `jp`, `fr`, `de`, `es`, `it`,
  `asi`…), sometimes comma-separated (`"us,eu"`).
- The rich `getGame` path is the only one affected by region. `exists` /
  `bulkLookup` take no region param; `systems` already uses `preferredRegion`.
- The `getGame` path is not yet wired into the UI, but the client + route must
  support region threading for when it is.

## Design

### 1. `lib/super-retrogamers/region.ts` (new, pure, tested)

- `SR_REGIONS = ['FR','EU','WOR','JP','US','ASI'] as const`; `type SrRegion`.
- `mapRomRegionToSr(romRegion?: string | null): SrRegion | null` — lowercase,
  split on `,`, return the first token that maps. Mapping covers the six exact
  codes plus common full-word aliases (`world→WOR`, `usa→US`, `japan→JP`,
  `europe→EU`, `france→FR`, `asia→ASI`). Unmapped (`de`, `es`, `it`, …) → `null`.
- `resolveRegion(romRegion, preferredRegion): SrRegion | ''` — fallback chain:
  `mapRomRegionToSr(romRegion) ?? (preferredRegion || '')`. Empty string means
  "send no `region` param" → API defaults to FR.

### 2. `getGame` region-aware

- Signature: `getGame(slug: string, romRegion?: string)` — backward compatible.
- `const region = resolveRegion(romRegion, cfg.preferredRegion)`.
- URL: `?region=<region>` when non-empty, omitted otherwise.
- Cache key includes the region: `game:${slug}:${region || 'FR'}` (same slug now
  yields different data per region).

### 3. `releaseDate`

- Add `releaseDate: string | null` to `SrGame` and the `mapSrGame` Zod schema
  (`z.string().nullish().transform(v => v ?? null)`). Top-level field, not in
  `specs`.

### 4. `app/api/super-retrogamers/games/[slug]/route.ts`

- Read optional `?region=` (raw ROM region) from the query; forward to
  `getGame(slug, region)`.
- Region-scoped cache key `game:${slug}:${resolved || 'FR'}` so stale-on-error
  fallback stays per-region. (Reuses `resolveRegion` to compute the key.)

### 5. Config: expand `preferredRegion`

- Enum → `'' | 'FR' | 'EU' | 'WOR' | 'US' | 'JP' | 'ASI'` in `lib/settings/schemas.ts`,
  the `PUT /api/settings` validator, and the settings dropdown (add FR/WOR/ASI).
  Default stays `''`.

## Testing (TDD)

- `region.test.ts` — mapping (exact codes, aliases, comma lists, unmapped) and
  `resolveRegion` fallback chain.
- `mapping.test.ts` — `releaseDate` present / null / absent.
- `client.test.ts` — region threading into URL, region-scoped cache key,
  `releaseDate` surfaced, backward-compatible no-region call.

## Out of scope

- Wiring the `getGame` rich card into the UI (no consumer today).
- Changing `exists` / `bulkLookup` / `systems` region behavior.
