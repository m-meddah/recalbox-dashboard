# Ticket 16 — Multi-disc / .m3u Generator

**Date:** 2026-05-19
**Status:** Approved
**Scope:** v1 — detection + generation + deployment. Hide-discs feature deferred.

---

## Context

Multi-disc games (PSX, Saturn, Sega CD…) require a `.m3u` playlist file listing all disc files so Recalbox/RetroArch can handle disc swapping. The dashboard already syncs ROM metadata from `gamelist.xml`. This feature detects multi-disc candidates from the synced DB and lets the user generate and deploy the missing `.m3u` files over SSH.

**Reference:** community tool `recalbox_m3u_master_v2.37.bat` (Windows) — this feature brings equivalent functionality natively into the dashboard.

---

## Constraints

- `.m3u` files must use **UNIX line endings (LF only, never CRLF)** — Recalbox refuses CRLF
- Never silently overwrite an existing `.m3u` with different content — require explicit confirmation
- If `.m3u` exists and is identical to what would be generated → silently skip (idempotent)
- Hide-discs (prefixing individual disc files with `.`) is **out of scope for v1**
- Strict TypeScript throughout

---

## Architecture

### New files

```text
lib/recalbox/multidisc-detector.ts         # detection logic
lib/recalbox/m3u-generator.ts              # content generation (pure)
app/api/m3u/candidates/route.ts            # GET endpoint
app/api/m3u/generate/route.ts              # POST endpoint
app/[locale]/collection/m3u/page.tsx       # UI page
components/m3u-candidates.tsx              # client component
lib/recalbox/__tests__/multidisc-detector.test.ts
lib/recalbox/__tests__/m3u-generator.test.ts
```

### Touched files

```text
app/[locale]/collection/page.tsx           # add "Multi-disc / .m3u" button
```

---

## Data model

No DB schema changes. Detection reads the existing `games` table (`system` + `romPath` columns).

### Types (`lib/recalbox/multidisc-detector.ts`)

```ts
export type DiscEntry = {
  fileName: string    // "Final Fantasy VII (USA) (Disc 1).chd"
  discNumber: number  // 1
}

export type MultiDiscGame = {
  system: string           // "psx"
  baseName: string         // "Final Fantasy VII (USA)"
  m3uFileName: string      // "Final Fantasy VII (USA).m3u"
  romsDir: string          // absolute path to the directory on Recalbox
  discs: DiscEntry[]       // sorted ascending by discNumber
  m3uAlreadyExists: boolean
  hasGap: boolean          // e.g. disc 1 + disc 3 present but disc 2 missing
}
```

---

## Detection algorithm (`multidisc-detector.ts`)

```text
detectMultiDiscGames(ssh, system?) → MultiDiscGame[]
```

1. Query `games` table: `SELECT system, rom_path FROM games [WHERE system = ?]`, filter to `MULTIDISC_SYSTEMS`
2. For each row: extract filename via `path.basename(romPath)`, run disc regex patterns → `{ baseName, discNumber }` or null
3. **baseName derivation: take the portion of the filename BEFORE the disc token** (not just strip the token from the middle). This correctly handles disc-specific qualifiers that follow the disc tag — e.g. `Biohazard 2 (Japan) (Disc 1) (Leon-hen).chd` and `Biohazard 2 (Japan) (Disc 2) (Claire-hen).chd` both yield baseName `Biohazard 2 (Japan)`. Confirmed against the real Recalbox collection (391 existing `.m3u` files follow this convention).
4. Group rows by `(system, path.dirname(romPath), baseName)` — grouping by directory handles collections spread across multiple USB disks. Discard groups with fewer than 2 entries.
5. For each unique directory: SSH `ls *.m3u` → set of existing `.m3u` names in that directory
6. Build `MultiDiscGame[]`: sort discs by `discNumber`, set `m3uAlreadyExists`, set `hasGap` (gaps in 1..maxDisc sequence)
7. The `.m3u` deployment path is `path.join(romsDir, m3uFileName)` — derived directly from the ROM path, no need for `listSystems()`

### Disc-capable systems

```ts
export const MULTIDISC_SYSTEMS = new Set([
  'psx', 'saturn', 'segacd', 'pcenginecd', '3do',
  'dreamcast', 'amigacd32', 'amigacdtv', 'neogeocd',
  'pcfx', 'cdi', 'naomigd',
])
```

### Regex patterns (case-insensitive, applied in order)

1. `\(\s*(?:disc|disk|cd)\s*[-_ ]*(\d+)(?:\s+of\s+\d+)?\s*\)` — matches `(Disc 1)`, `(Disc 1 of 3)`, `(CD 1)`
2. `\[\s*(?:disc|disk|cd)\s*[-_ ]*(\d+)(?:\s+of\s+\d+)?\s*\]` — matches `[Disc 1]`
3. `(?:^|[\s\-_])(?:disc|disk|cd)\s*[-_ ]*(\d+)(?=$|[\s\-_])` — matches bare `Disc 1`
4. `(?:^|[\s\-_])cd(\d+)(?=$|[\s\-_])` — matches `CD1`, `cd2`

After matching: remove the disc token from the filename → `baseName`. Discard if `discNumber < 1` or `discNumber > 10` or `baseName` is empty.

`(Part N)` is **excluded from v1** — too ambiguous (many game titles contain "Part").

---

## Content generation (`m3u-generator.ts`)

```ts
// Join disc filenames with LF; never CRLF.
export function generateM3uContent(game: MultiDiscGame): string {
  return game.discs.map(d => d.fileName).join('\n') + '\n'
}

// Replace characters invalid in filenames with '_', collapse whitespace.
export function sanitizeM3uFileName(baseName: string): string { ... }
```

---

## API routes

### `GET /api/m3u/candidates`

Query param: `system` (optional).

Response:

```ts
{
  candidates: MultiDiscGame[]
  systems: string[]   // disc-capable systems present in DB
}
```

Runtime: `nodejs`, `dynamic = 'force-dynamic'`.

### `POST /api/m3u/generate`

Request:

```ts
{
  recalboxId?: string
  games: Array<{ system: string; baseName: string; romsDir: string }>
}
```

Response:

```ts
{
  results: Array<{
    system: string
    baseName: string
    m3uFileName: string
    status: 'created' | 'skipped' | 'error'
    reason?: 'already_identical' | 'already_exists'
    error?: string
  }>
  summary: { created: number; skipped: number; errors: number }
}
```

**Idempotency logic per game:**

1. Re-detect discs from DB for `(system, baseName, romsDir)`
2. SSH: check if `.m3u` already exists
   - Exists + identical content → `skipped / already_identical`
   - Exists + different content → `skipped / already_exists` (UI handles confirmation)
   - Missing → write file

**SSH write strategy (avoids all shell quoting issues for file content):**

```bash
printf '%s' 'BASE64_ENCODED_CONTENT' | base64 -d > '/shell/quoted/path.m3u'
```

Content is base64-encoded before the SSH call; path is wrapped with `shellQuote()`.

---

## UI

### Navigation

Add a "Multi-disc / .m3u" button on `/collection` page next to `SyncButton`. Links to `/collection/m3u`.

### Page layout (`/collection/m3u`)

```text
┌─────────────────────────────────────────────────────┐
│ ← Collection   Multi-disc / .m3u                    │
│                                                     │
│ 12 multi-disc games · 3 systems · 8 .m3u missing   │
│                                    [Generate missing]│
├─────────────────────────────────────────────────────┤
│ PlayStation (psx)         8 games · 5 missing       │
│ ─────────────────────────────────────────────────── │
│ ✓ Final Fantasy VII (USA)    3 discs   .m3u OK      │
│ ⚠ Chrono Cross (USA)         2 discs   missing  [Generate]
│ ⚠ Metal Gear Solid (USA)     2 discs   missing  [Generate]
│ ⚡ Parasite Eve (USA)         2 discs   gap!    [Generate]
│ ≠ Some Game (USA)            2 discs   differs [Update]
│                                                     │
│ Saturn (saturn)           4 games · 3 missing       │
└─────────────────────────────────────────────────────┘
```

### Status indicators

| Icon | Meaning |
| ---- | ------- |
| `✓` | `.m3u` exists and matches expected content |
| `⚠` | `.m3u` missing |
| `⚡` | Gap in disc sequence (e.g. disc 1 + disc 3, no disc 2) — warning tooltip, generation still allowed |
| `≠` | `.m3u` exists but content differs — "Update" button with confirmation modal |

### Actions

- **[Generate]** on a single game — creates missing `.m3u`, no confirmation needed
- **[Update]** on a `≠` game — shows confirmation modal with diff (current vs expected)
- **[Generate missing]** batch — processes all `⚠` games across all systems, skips `✓` and `≠`

### UX details

- Skeleton loader while fetching candidates (SSH `ls` round-trips take 1–2s)
- Hover/click on a game row shows a popover with the `.m3u` content preview
- Post-generation banner: _"A re-scan in EmulationStation may be needed for the .m3u files to appear in Recalbox."_
- If no multi-disc games found: empty state with hint to sync the collection first

---

## Tests

### `multidisc-detector.test.ts`

**Pattern matching (unit, no SSH):**

- `"Final Fantasy VII (USA) (Disc 1).chd"` → `{ baseName: "Final Fantasy VII (USA)", discNumber: 1 }`
- `"Game (USA) (Disc 1 of 3).chd"` → `{ baseName: "Game (USA)", discNumber: 1 }`
- `"Game (CD 1).chd"` → `{ baseName: "Game", discNumber: 1 }`
- `"Game (CD1).chd"` → `{ baseName: "Game", discNumber: 1 }`
- `"Game [Disc 2].chd"` → `{ baseName: "Game", discNumber: 2 }`
- `"Game Disc 1.chd"` → `{ baseName: "Game", discNumber: 1 }`
- `"Super Mario World.sfc"` → `null`
- `"007 - GoldenEye (USA).z64"` → `null`
- `"Disc Jockey Simulator.chd"` → `null` (title contains "Disc" but no number after it)
- `"Biohazard 2 (Japan) (Disc 1) (Leon-hen).chd"` → `{ baseName: "Biohazard 2 (Japan)", discNumber: 1 }` (disc-specific qualifier after tag is dropped)
- `"Beat Mania (Japan) (Disc 1) (Arcade).chd"` → `{ baseName: "Beat Mania (Japan)", discNumber: 1 }`

**Grouping:**

- 3 disc files → 1 group, 3 entries sorted by discNumber
- `[disc1, disc3]` → `hasGap: true`
- Single disc file → group discarded (< 2)

**SSH mock:**

- Existing `.m3u` in `ls` output → `m3uAlreadyExists: true`

### `m3u-generator.test.ts`

- Content is disc filenames joined by `\n`, ending with `\n`
- `content.includes('\r')` → `false` (explicit CRLF check)
- `content.endsWith('\n')` → `true`
- `sanitizeM3uFileName("Game: Subtitle (USA)")` → `"Game_ Subtitle (USA).m3u"`

---

## Out of scope (v1)

- Hide-discs: prefixing individual disc files with `.` to hide them from EmulationStation scraper. Deferred — requires careful `.cue`/`.bin` handling and is a destructive file rename operation.
- Per-system M3U support warnings (whether the system recognises `.m3u` natively in the user's Recalbox version).

---

## Commit

`feat(m3u): multi-disc detection and .m3u generation`
