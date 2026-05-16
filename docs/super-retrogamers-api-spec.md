# Super Retrogamers Public API — Specification

Version: 1.0 (Draft)  
Base URL: `https://super-retrogamers.com/api/v1`

## Requirements

- CORS: `Access-Control-Allow-Origin: *`
- Content-Type: `application/json`
- Cache-Control headers on all responses

## Game slug format

`{normalized-game-name}-console-{console-slug}`

Example: `super-mario-world-console-super-nintendo`

**Normalization rules** (applied by `gameToSlug()` in `lib/super-retrogamers/slug.ts`):
1. Strip file extension
2. Remove region tags — `(USA)`, `(E)`, `(Japan)`, etc.
3. Remove version markers — `(v1.0)`, `(Rev A)`, `[!]`, etc.
4. Lowercase + decompose accented characters (é → e)
5. Remove apostrophes and punctuation (`:`, `.`, `!`, `?`)
6. Spaces, hyphens, underscores → single dash
7. Collapse multiple dashes, trim leading/trailing
8. Append `-console-{console-slug}`

---

## Endpoints

### GET /games/exists?slug={slug}

Lightweight existence check. No body, safe to cache aggressively.

**Response 200 (found):**
```json
{ "exists": true, "url": "https://super-retrogamers.com/games/super-mario-world-console-super-nintendo" }
```

**Response 200 (not found):**
```json
{ "exists": false }
```

`Cache-Control: public, max-age=86400` (24 h)

---

### GET /games/:slug

Full game data.

**Response 200:**
```json
{
  "slug": "super-mario-world-console-super-nintendo",
  "name": "Super Mario World",
  "consoleSlug": "super-nintendo",
  "score": 95,
  "summary": "A platforming masterpiece that defined the SNES launch.",
  "specs": {
    "release": "1990",
    "developer": "Nintendo",
    "genre": "Platformer",
    "players": "1-2"
  },
  "characters": ["Mario", "Yoshi", "Bowser", "Princess Peach"],
  "url": "https://super-retrogamers.com/games/super-mario-world-console-super-nintendo"
}
```

**Response 404:**
```json
{ "error": "Not found" }
```

`Cache-Control: public, max-age=43200` (12 h)

---

### POST /games/lookup

Bulk existence check. Maximum 100 slugs per request.

**Request:**
```json
{ "slugs": ["super-mario-world-console-super-nintendo", "mega-man-7-console-super-nintendo"] }
```

**Response 200:**
```json
{
  "results": {
    "super-mario-world-console-super-nintendo": {
      "exists": true,
      "url": "https://super-retrogamers.com/games/super-mario-world-console-super-nintendo"
    },
    "mega-man-7-console-super-nintendo": { "exists": false }
  }
}
```

`Cache-Control: no-store`

---

### GET /systems

List all covered console systems.

**Response 200:**
```json
{
  "systems": [
    { "slug": "super-nintendo", "name": "Super Nintendo Entertainment System" },
    { "slug": "megadrive", "name": "Sega Mega Drive / Genesis" },
    { "slug": "playstation", "name": "Sony PlayStation" }
  ]
}
```

`Cache-Control: public, max-age=604800` (7 days)

---

## Console slug mapping

The dashboard uses this mapping (see `SR_SYSTEM_SLUGS` in `lib/super-retrogamers/slug.ts`):

| Recalbox system ID | SR console slug      |
|--------------------|----------------------|
| snes               | super-nintendo       |
| nes                | nes                  |
| megadrive          | megadrive            |
| gb                 | game-boy             |
| gbc                | game-boy-color       |
| gba                | game-boy-advance     |
| psx                | playstation          |
| ps2                | playstation-2        |
| ps3                | playstation-3        |
| psp                | psp                  |
| gc                 | gamecube             |
| n64                | nintendo-64          |
| nds                | nintendo-ds          |
| wii                | wii                  |
| dreamcast          | dreamcast            |
| saturn             | saturn               |
| segacd             | mega-cd              |
| mastersystem       | master-system        |
| neogeo             | neo-geo              |
| pcengine           | pc-engine            |

---

## Dashboard integration overview

The dashboard (Phase 1) ships with the API client hardcoded to return `{ exists: false }` — no real HTTP calls are made. When Phase 2 is ready (API implemented on super-retrogamers.com), update `SuperRetrogamersClient` in `lib/super-retrogamers/client.ts` to make real requests.

Proxy routes at `/api/super-retrogamers/*` sit between the browser and the SR API, providing:
- Local SQLite cache (`sr_cache` table) with TTL-based expiry
- Stale-while-revalidate semantics (serve stale if SR is unreachable)
- Batch enrichment (`/api/super-retrogamers/enrich-collection`) via NDJSON stream
