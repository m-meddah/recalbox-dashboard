# HowLongToBeat Integration — Design Spec

**Date:** 2026-05-30
**Status:** Approved

## Goal

Integrate HowLongToBeat (HLTB) duration data into the recommendation algorithm to enable time-aware game suggestions — primarily for the `finish` mood, with a smaller impact on all other moods.

---

## Decisions

| Question | Choice |
|---|---|
| Moods affected | `finish` heavily, all others small bonus |
| Durations to store | All three: Main Story, Main + Extras, Completionist |
| Missing HLTB data in `finish` mode | Exclude the game |
| Missing HLTB data in other moods | Fall back to existing genre/system heuristics |
| Matching strategy | Direct HTTP client (no npm package) |
| Cache TTL | 365 days |

---

## Architecture

### New module: `lib/hltb/`

Mirrors the existing `lib/igdb/` structure:

```
lib/hltb/
  client.ts          — HTTP client for HLTB internal API
  match-game.ts      — name matching logic (exact → cleaned → fuzzy)
  match-single.ts    — async lazy match for a single game
  batch-match.ts     — batch match for the full collection
```

### HLTB API

HLTB exposes an internal search endpoint (no API key required):

```
POST https://howlongtobeat.com/api/search
Content-Type: application/json
Referer: https://howlongtobeat.com/

{ "searchTerms": ["<name>"], "searchPage": 1, "size": 5 }
```

The response includes `comp_main`, `comp_plus`, `comp_100` fields (in seconds).

`client.ts` sends this request with appropriate headers and returns raw results. No retries — failures are silently ignored and the game stays unmatched (will be retried next recommendation cycle).

### Name matching

Reuses `cleanRomName` and `generateNameVariants` from `lib/igdb/clean-rom-name.ts` (no duplication). Match strategy:

1. Exact cleaned name → confidence 1.0
2. Name variants (roman numerals, accents, subtitles) → confidence 0.85
3. Fuzzy (Levenshtein ≥ 0.7) → confidence 0.7–0.85, `needsReview = true`
4. Not found → stored as `hltb_id = null` to avoid repeated failed lookups

Platform is **not** sent to HLTB (their search is name-only). The name cleaning + variants handle most disambiguation.

---

## Database Schema

### `game_hltb_mapping`

```sql
game_id          INTEGER PRIMARY KEY  -- FK → games.id
hltb_id          INTEGER              -- null = confirmed not found
hltb_name        TEXT
match_confidence REAL
match_method     TEXT                 -- 'exact' | 'cleaned' | 'fuzzy' | 'not_found'
matched_at       INTEGER              -- unix seconds
needs_review     INTEGER DEFAULT 0
```

### `hltb_cache`

```sql
hltb_id              INTEGER PRIMARY KEY
name                 TEXT NOT NULL
main_story_seconds   INTEGER   -- null if HLTB doesn't provide it
main_extras_seconds  INTEGER
completionist_seconds INTEGER
fetched_at           INTEGER
expires_at           INTEGER   -- fetched_at + 365 days
```

Index on `expires_at` for cache invalidation queries.

---

## Scoring Integration

### `GameForScoring` — new field

```ts
hltbDurations: {
  mainStory: number | null       // seconds
  mainExtras: number | null
  completionist: number | null
} | null
```

`null` = no HLTB match found.

### `recommend.ts` — loading HLTB data

A new `loadHltbDurations()` function (same shape as `loadIgdbRatings()`):

```ts
async function loadHltbDurations(): Promise<Map<number, HltbDurations>>
```

Joins `game_hltb_mapping` + `hltb_cache` on `hltb_id`, returns a map keyed by `game_id`. Games with `hltb_id = null` are absent from the map (no entry = no data).

### `score-game.ts` — `finish` mood

Reference duration selection: `mainStory → mainExtras → completionist` (first non-null).

If `hltbDurations` is `null` → `return null` (excluded from results).

If reference duration exists, score the time fit:

| Ratio: `refMinutes / availableMinutes` | Score delta | Reason string |
|---|---|---|
| ≤ 1× | +40 | `"Finissable ce soir (~Xh)"` |
| ≤ 2× | +25 | `"Encore 1-2 sessions (~Xh)"` |
| ≤ 4× | +10 | *(silent)* |
| > 4× | -15 | *(silent — game stays candidate since it's in progress)* |

### `score-game.ts` — all other moods (time fit bonus)

The existing `estimateTimeMatch` function is extended: if `hltbDurations` is available, check whether any of the three durations falls within ±50% of `availableMinutes`. If so, add **+10 pts**. Otherwise (or if no HLTB data), the existing genre/system heuristics run unchanged.

---

## Matching Triggers

### Lazy (automatic)

At the end of `recommend()`, after scoring, the top 30 games without a `game_hltb_mapping` entry are queued for `matchHltbAsync()` — fire-and-forget, does not block the response. One game at a time, 500ms delay between requests.

### Batch (manual)

New endpoint: `POST /api/hltb/batch-match`

Iterates all games without a mapping entry, 500ms between requests. Designed to be triggered once from the Settings page (same pattern as the IGDB batch match button).

---

## Error Handling

- **HLTB API down / rate-limited**: catch and swallow. The game stays unmatched and will be retried on the next recommendation call.
- **No match found**: stored as `hltb_id = null` to prevent repeated lookups. TTL still applies — after 365 days, the mapping is invalidated and a fresh lookup is attempted.
- **Partial data** (e.g., `comp_main` present but `comp_100` absent): stored as-is, `null` for missing fields.

---

## Out of Scope

- Showing HLTB durations on game detail pages
- User-editable duration overrides
- IGDB → HLTB ID bridge (direct name matching is sufficient)
- Platform filtering in HLTB search (HLTB search is name-only)
