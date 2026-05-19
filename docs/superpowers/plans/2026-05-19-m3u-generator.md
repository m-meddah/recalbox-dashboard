# M3U Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect multi-disc games from the synced DB and let the user generate + deploy `.m3u` playlist files to Recalbox over SSH from a dedicated `/collection/m3u` page.

**Architecture:** Pure functions (`detectDiscInfo`, `generateM3uContent`, `sanitizeM3uFileName`) tested in isolation; `detectMultiDiscGames` wires DB query + SSH ls; two API routes handle reads and writes; a client component drives the UI with skeleton loading and per-game actions.

**Tech Stack:** TypeScript strict, Drizzle ORM (better-sqlite3), node-ssh (existing `SshClientLike`), Next.js 16 App Router, shadcn/ui, Vitest, next-intl.

---

## File Map

| File | Action | Responsibility |
| ---- | ------ | -------------- |
| `lib/recalbox/multidisc-detector.ts` | **Create** | Types + `detectDiscInfo` + `detectMultiDiscGames` |
| `lib/recalbox/m3u-generator.ts` | **Create** | `generateM3uContent` + `sanitizeM3uFileName` |
| `lib/recalbox/__tests__/multidisc-detector.test.ts` | **Create** | Tests for both pure and SSH-dependent functions |
| `lib/recalbox/__tests__/m3u-generator.test.ts` | **Create** | Tests for pure generation functions |
| `app/api/m3u/candidates/route.ts` | **Create** | `GET /api/m3u/candidates` |
| `app/api/m3u/generate/route.ts` | **Create** | `POST /api/m3u/generate` |
| `app/[locale]/collection/m3u/page.tsx` | **Create** | Server page wrapper with i18n |
| `components/m3u-candidates.tsx` | **Create** | Client component: list, status, actions |
| `app/[locale]/collection/page.tsx` | **Modify** | Add "Multi-disc / .m3u" nav button |
| `messages/en.json` | **Modify** | Add `m3u` namespace |
| `messages/fr.json` | **Modify** | Add `m3u` namespace (French) |

All paths are relative to `apps/dashboard/`.

---

## Task 1: Pure generation functions + tests

**Files:**
- Create: `lib/recalbox/m3u-generator.ts`
- Create: `lib/recalbox/__tests__/m3u-generator.test.ts`

- [ ] **Step 1.1 — Write the failing tests**

Create `apps/dashboard/lib/recalbox/__tests__/m3u-generator.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generateM3uContent, sanitizeM3uFileName } from '../m3u-generator'
import type { MultiDiscGame } from '../multidisc-detector'

function makeGame(discs: Array<{ fileName: string; discNumber: number }>): MultiDiscGame {
  return {
    system: 'psx',
    baseName: 'Test Game (USA)',
    m3uFileName: 'Test Game (USA).m3u',
    romsDir: '/recalbox/share/roms/psx',
    discs,
    m3uAlreadyExists: false,
    hasGap: false,
  }
}

describe('generateM3uContent', () => {
  it('joins disc filenames with LF', () => {
    const game = makeGame([
      { fileName: 'Final Fantasy VII (USA) (Disc 1).chd', discNumber: 1 },
      { fileName: 'Final Fantasy VII (USA) (Disc 2).chd', discNumber: 2 },
      { fileName: 'Final Fantasy VII (USA) (Disc 3).chd', discNumber: 3 },
    ])
    const content = generateM3uContent(game)
    expect(content).toBe(
      'Final Fantasy VII (USA) (Disc 1).chd\nFinal Fantasy VII (USA) (Disc 2).chd\nFinal Fantasy VII (USA) (Disc 3).chd\n',
    )
  })

  it('ends with a trailing LF', () => {
    const game = makeGame([
      { fileName: 'Game (Disc 1).chd', discNumber: 1 },
      { fileName: 'Game (Disc 2).chd', discNumber: 2 },
    ])
    expect(generateM3uContent(game).endsWith('\n')).toBe(true)
  })

  it('contains NO carriage returns (no CRLF)', () => {
    const game = makeGame([
      { fileName: 'Game (Disc 1).chd', discNumber: 1 },
      { fileName: 'Game (Disc 2).chd', discNumber: 2 },
    ])
    expect(generateM3uContent(game)).not.toContain('\r')
  })

  it('works with two discs', () => {
    const game = makeGame([
      { fileName: 'Metal Gear Solid (USA) (Disc 1).chd', discNumber: 1 },
      { fileName: 'Metal Gear Solid (USA) (Disc 2).chd', discNumber: 2 },
    ])
    const lines = generateM3uContent(game).split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
  })
})

describe('sanitizeM3uFileName', () => {
  it('appends .m3u extension', () => {
    expect(sanitizeM3uFileName('Final Fantasy VII (USA)')).toBe('Final Fantasy VII (USA).m3u')
  })

  it('replaces characters invalid in filenames with underscore', () => {
    expect(sanitizeM3uFileName('Game: Subtitle (USA)')).toBe('Game_ Subtitle (USA).m3u')
    expect(sanitizeM3uFileName('Game/Sub (USA)')).toBe('Game_Sub (USA).m3u')
    expect(sanitizeM3uFileName('Game*Sub (USA)')).toBe('Game_Sub (USA).m3u')
  })

  it('collapses multiple spaces', () => {
    expect(sanitizeM3uFileName('Game  Title (USA)')).toBe('Game Title (USA).m3u')
  })

  it('leaves normal names unchanged', () => {
    expect(sanitizeM3uFileName("3x3 Eyes - Tenrin'ou Genmu (Japan)")).toBe(
      "3x3 Eyes - Tenrin'ou Genmu (Japan).m3u",
    )
  })
})
```

- [ ] **Step 1.2 — Run tests to verify they fail**

```bash
cd apps/dashboard && pnpm vitest run lib/recalbox/__tests__/m3u-generator.test.ts
```

Expected: `FAIL` — module `../m3u-generator` not found.

- [ ] **Step 1.3 — Implement `m3u-generator.ts`**

Create `apps/dashboard/lib/recalbox/m3u-generator.ts`:

```ts
import type { MultiDiscGame } from './multidisc-detector'

export function generateM3uContent(game: MultiDiscGame): string {
  return game.discs.map((d) => d.fileName).join('\n') + '\n'
}

export function sanitizeM3uFileName(baseName: string): string {
  return (
    baseName
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() + '.m3u'
  )
}
```

Note: this file imports `MultiDiscGame` from `multidisc-detector.ts`. Create a minimal type stub there first (the full implementation comes in Task 2):

Create `apps/dashboard/lib/recalbox/multidisc-detector.ts` with just the types:

```ts
export type DiscEntry = {
  fileName: string
  discNumber: number
}

export type MultiDiscGame = {
  system: string
  baseName: string
  m3uFileName: string
  romsDir: string
  discs: DiscEntry[]
  m3uAlreadyExists: boolean
  hasGap: boolean
}

export const MULTIDISC_SYSTEMS = new Set([
  'psx', 'saturn', 'segacd', 'pcenginecd', '3do',
  'dreamcast', 'amigacd32', 'amigacdtv', 'neogeocd',
  'pcfx', 'cdi', 'naomigd',
])

// Implementations added in Task 2
```

- [ ] **Step 1.4 — Run tests to verify they pass**

```bash
cd apps/dashboard && pnpm vitest run lib/recalbox/__tests__/m3u-generator.test.ts
```

Expected: all tests `PASS`.

- [ ] **Step 1.5 — Commit**

```bash
git add apps/dashboard/lib/recalbox/m3u-generator.ts \
        apps/dashboard/lib/recalbox/multidisc-detector.ts \
        apps/dashboard/lib/recalbox/__tests__/m3u-generator.test.ts
git commit -m "feat(m3u): add generateM3uContent and sanitizeM3uFileName with tests"
```

---

## Task 2: `detectDiscInfo` — disc pattern parser + tests

**Files:**
- Modify: `lib/recalbox/multidisc-detector.ts`
- Create: `lib/recalbox/__tests__/multidisc-detector.test.ts`

- [ ] **Step 2.1 — Write the failing tests**

Create `apps/dashboard/lib/recalbox/__tests__/multidisc-detector.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectDiscInfo } from '../multidisc-detector'

describe('detectDiscInfo', () => {
  // ─── Standard Redump patterns ──────────────────────────────────────────────

  it('detects (Disc 1)', () => {
    expect(detectDiscInfo('Final Fantasy VII (USA) (Disc 1).chd')).toEqual({
      baseName: 'Final Fantasy VII (USA)',
      discNumber: 1,
    })
  })

  it('detects (Disc 2)', () => {
    expect(detectDiscInfo('Final Fantasy VII (USA) (Disc 2).chd')).toEqual({
      baseName: 'Final Fantasy VII (USA)',
      discNumber: 2,
    })
  })

  it('detects (Disc 1 of 3)', () => {
    expect(detectDiscInfo('Game (USA) (Disc 1 of 3).chd')).toEqual({
      baseName: 'Game (USA)',
      discNumber: 1,
    })
  })

  it('detects (Disk 1) — alternate spelling', () => {
    expect(detectDiscInfo('Game (USA) (Disk 1).chd')).toEqual({
      baseName: 'Game (USA)',
      discNumber: 1,
    })
  })

  it('detects (CD 1)', () => {
    expect(detectDiscInfo('Game (CD 1).chd')).toEqual({
      baseName: 'Game',
      discNumber: 1,
    })
  })

  it('detects (CD1) — no space', () => {
    expect(detectDiscInfo('Game (CD1).chd')).toEqual({
      baseName: 'Game',
      discNumber: 1,
    })
  })

  it('detects [Disc 2] — square brackets', () => {
    expect(detectDiscInfo('Game [Disc 2].chd')).toEqual({
      baseName: 'Game',
      discNumber: 2,
    })
  })

  it('detects bare "Disc 1" without brackets', () => {
    expect(detectDiscInfo('Game Disc 1.chd')).toEqual({
      baseName: 'Game',
      discNumber: 1,
    })
  })

  // ─── Disc-specific qualifier after disc tag (real collection) ──────────────

  it('strips disc-specific qualifier after (Disc N) — Leon-hen', () => {
    expect(detectDiscInfo('Biohazard 2 (Japan) (Disc 1) (Leon-hen).chd')).toEqual({
      baseName: 'Biohazard 2 (Japan)',
      discNumber: 1,
    })
  })

  it('strips disc-specific qualifier after (Disc N) — Arcade', () => {
    expect(detectDiscInfo('Beat Mania (Japan) (Disc 1) (Arcade).chd')).toEqual({
      baseName: 'Beat Mania (Japan)',
      discNumber: 1,
    })
  })

  it('handles 4 discs', () => {
    expect(
      detectDiscInfo('70\'s Robot Anime - Geppy-X (Japan) (Disc 4).chd'),
    ).toEqual({
      baseName: "70's Robot Anime - Geppy-X (Japan)",
      discNumber: 4,
    })
  })

  // ─── Negative cases — must NOT match ──────────────────────────────────────

  it('returns null for single-disc ROM without disc tag', () => {
    expect(detectDiscInfo('Super Mario World.sfc')).toBeNull()
  })

  it('returns null for 007 — number in title, not disc tag', () => {
    expect(detectDiscInfo('007 - GoldenEye (USA).z64')).toBeNull()
  })

  it('returns null when title contains "Disc" but no number', () => {
    expect(detectDiscInfo('Disc Jockey Simulator.chd')).toBeNull()
  })

  it('returns null for series numbers at end — 16 Tales 1', () => {
    expect(detectDiscInfo('16 Tales 1 (USA).chd')).toBeNull()
  })

  it('returns null when disc number is 0', () => {
    expect(detectDiscInfo('Game (Disc 0).chd')).toBeNull()
  })

  it('returns null when disc number exceeds 10', () => {
    expect(detectDiscInfo('Game (Disc 11).chd')).toBeNull()
  })

  it('returns null when baseName would be empty', () => {
    expect(detectDiscInfo('(Disc 1).chd')).toBeNull()
  })
})
```

- [ ] **Step 2.2 — Run tests to verify they fail**

```bash
cd apps/dashboard && pnpm vitest run lib/recalbox/__tests__/multidisc-detector.test.ts
```

Expected: `FAIL` — `detectDiscInfo` is not exported.

- [ ] **Step 2.3 — Implement `detectDiscInfo`**

Replace the contents of `apps/dashboard/lib/recalbox/multidisc-detector.ts` with:

```ts
import type { SshClientLike } from './ssh-client'
import { sanitizeM3uFileName } from './m3u-generator'
import { shellQuote } from './shell'
import { db } from '@/lib/db/index'
import { games } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'
import { basename as pathBasename, dirname } from 'node:path'

export type DiscEntry = {
  fileName: string
  discNumber: number
}

export type MultiDiscGame = {
  system: string
  baseName: string
  m3uFileName: string
  romsDir: string
  discs: DiscEntry[]
  m3uAlreadyExists: boolean
  hasGap: boolean
}

export const MULTIDISC_SYSTEMS = new Set([
  'psx', 'saturn', 'segacd', 'pcenginecd', '3do',
  'dreamcast', 'amigacd32', 'amigacdtv', 'neogeocd',
  'pcfx', 'cdi', 'naomigd',
])

// Applied in order; baseName = filename portion BEFORE the match (trimEnd).
const DISC_PATTERNS: RegExp[] = [
  /\(\s*(?:disc|disk|cd)\s*[-_ ]*(\d+)(?:\s+of\s+\d+)?\s*\)/i,
  /\[\s*(?:disc|disk|cd)\s*[-_ ]*(\d+)(?:\s+of\s+\d+)?\s*\]/i,
  /(?:^|[\s\-_])(?:disc|disk|cd)\s*[-_ ]*(\d+)(?=$|[\s\-_])/i,
  /(?:^|[\s\-_])cd(\d+)(?=$|[\s\-_])/i,
]

export function detectDiscInfo(
  filename: string,
): { baseName: string; discNumber: number } | null {
  const stem = filename.replace(/\.[^.]+$/, '')

  for (const pattern of DISC_PATTERNS) {
    const match = pattern.exec(stem)
    if (!match) continue

    const discNumber = parseInt(match[1], 10)
    if (discNumber < 1 || discNumber > 10) return null

    const baseName = stem.slice(0, match.index).trimEnd()
    if (!baseName) return null

    return { baseName, discNumber }
  }
  return null
}

// detectMultiDiscGames added in Task 3
```

- [ ] **Step 2.4 — Run tests to verify they pass**

```bash
cd apps/dashboard && pnpm vitest run lib/recalbox/__tests__/multidisc-detector.test.ts
```

Expected: all tests `PASS`. Also run the generator tests to confirm no regression:

```bash
cd apps/dashboard && pnpm vitest run lib/recalbox/__tests__/m3u-generator.test.ts
```

- [ ] **Step 2.5 — Commit**

```bash
git add apps/dashboard/lib/recalbox/multidisc-detector.ts \
        apps/dashboard/lib/recalbox/__tests__/multidisc-detector.test.ts
git commit -m "feat(m3u): add detectDiscInfo with all disc patterns and tests"
```

---

## Task 3: `detectMultiDiscGames` — grouping + SSH check + tests

**Files:**
- Modify: `lib/recalbox/multidisc-detector.ts`
- Modify: `lib/recalbox/__tests__/multidisc-detector.test.ts`

- [ ] **Step 3.1 — Add tests for `detectMultiDiscGames`**

Append to `apps/dashboard/lib/recalbox/__tests__/multidisc-detector.test.ts`:

```ts
import { beforeEach, vi } from 'vitest'
import { detectMultiDiscGames } from '../multidisc-detector'
import type { SshClientLike } from '../ssh-client'

// ─── DB mock ────────────────────────────────────────────────────────────────

type GameRow = { system: string; romPath: string }

const mockState = vi.hoisted(() => {
  let rows: GameRow[] = []
  return {
    setRows: (r: GameRow[]) => { rows = r },
    getRows: () => rows,
  }
})

vi.mock('@/lib/db/index', () => {
  const fakeDb: Record<string, () => unknown> = {}
  fakeDb.select = () => fakeDb
  fakeDb.from = () => fakeDb
  fakeDb.where = () => fakeDb
  fakeDb.all = () => mockState.getRows()
  return { db: fakeDb }
})

vi.mock('@/lib/db/schema', () => ({ games: { system: 'system', romPath: 'romPath' } }))

// ─── SSH mock ───────────────────────────────────────────────────────────────

function makeMockSsh(lsOutput = ''): SshClientLike {
  return { exec: vi.fn().mockResolvedValue(lsOutput) }
}

beforeEach(() => {
  mockState.setRows([])
  vi.clearAllMocks()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('detectMultiDiscGames', () => {
  it('groups two-disc game correctly', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Final Fantasy VII (USA) (Disc 1).chd' },
      { system: 'psx', romPath: '/roms/psx/Final Fantasy VII (USA) (Disc 2).chd' },
    ])
    const ssh = makeMockSsh('')
    const result = await detectMultiDiscGames(ssh)

    expect(result).toHaveLength(1)
    expect(result[0].baseName).toBe('Final Fantasy VII (USA)')
    expect(result[0].system).toBe('psx')
    expect(result[0].discs).toHaveLength(2)
    expect(result[0].discs[0].discNumber).toBe(1)
    expect(result[0].discs[1].discNumber).toBe(2)
  })

  it('sorts discs in ascending order', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Game (Disc 3).chd' },
      { system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
      { system: 'psx', romPath: '/roms/psx/Game (Disc 2).chd' },
    ])
    const result = await detectMultiDiscGames(makeMockSsh())
    expect(result[0].discs.map((d) => d.discNumber)).toEqual([1, 2, 3])
  })

  it('discards single-disc groups', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Vagrant Story (USA).chd' },
      { system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
    ])
    const result = await detectMultiDiscGames(makeMockSsh())
    expect(result).toHaveLength(0)
  })

  it('detects hasGap when disc 2 is missing', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
      { system: 'psx', romPath: '/roms/psx/Game (Disc 3).chd' },
    ])
    const result = await detectMultiDiscGames(makeMockSsh())
    expect(result[0].hasGap).toBe(true)
  })

  it('sets hasGap: false for consecutive discs', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
      { system: 'psx', romPath: '/roms/psx/Game (Disc 2).chd' },
      { system: 'psx', romPath: '/roms/psx/Game (Disc 3).chd' },
    ])
    const result = await detectMultiDiscGames(makeMockSsh())
    expect(result[0].hasGap).toBe(false)
  })

  it('sets m3uAlreadyExists when .m3u present in SSH ls output', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Final Fantasy VII (USA) (Disc 1).chd' },
      { system: 'psx', romPath: '/roms/psx/Final Fantasy VII (USA) (Disc 2).chd' },
    ])
    const ssh = makeMockSsh('Final Fantasy VII (USA).m3u\n')
    const result = await detectMultiDiscGames(ssh)
    expect(result[0].m3uAlreadyExists).toBe(true)
  })

  it('sets m3uAlreadyExists: false when .m3u absent', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Metal Gear Solid (USA) (Disc 1).chd' },
      { system: 'psx', romPath: '/roms/psx/Metal Gear Solid (USA) (Disc 2).chd' },
    ])
    const ssh = makeMockSsh('')
    const result = await detectMultiDiscGames(ssh)
    expect(result[0].m3uAlreadyExists).toBe(false)
  })

  it('groups games from different systems separately', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
      { system: 'psx', romPath: '/roms/psx/Game (Disc 2).chd' },
      { system: 'saturn', romPath: '/roms/saturn/Game (Disc 1).chd' },
      { system: 'saturn', romPath: '/roms/saturn/Game (Disc 2).chd' },
    ])
    const result = await detectMultiDiscGames(makeMockSsh())
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.system).sort()).toEqual(['psx', 'saturn'])
  })

  it('filters to specific system when provided', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Game (Disc 1).chd' },
      { system: 'psx', romPath: '/roms/psx/Game (Disc 2).chd' },
      { system: 'saturn', romPath: '/roms/saturn/Other (Disc 1).chd' },
      { system: 'saturn', romPath: '/roms/saturn/Other (Disc 2).chd' },
    ])
    const result = await detectMultiDiscGames(makeMockSsh(), 'psx')
    expect(result).toHaveLength(1)
    expect(result[0].system).toBe('psx')
  })

  it('returns [] for non-disc-capable system', async () => {
    const result = await detectMultiDiscGames(makeMockSsh(), 'snes')
    expect(result).toEqual([])
  })

  it('handles disc-specific qualifier — baseName is prefix before disc tag', async () => {
    mockState.setRows([
      { system: 'psx', romPath: '/roms/psx/Biohazard 2 (Japan) (Disc 1) (Leon-hen).chd' },
      { system: 'psx', romPath: '/roms/psx/Biohazard 2 (Japan) (Disc 2) (Claire-hen).chd' },
    ])
    const result = await detectMultiDiscGames(makeMockSsh())
    expect(result).toHaveLength(1)
    expect(result[0].baseName).toBe('Biohazard 2 (Japan)')
  })
})
```

- [ ] **Step 3.2 — Run tests to verify they fail**

```bash
cd apps/dashboard && pnpm vitest run lib/recalbox/__tests__/multidisc-detector.test.ts
```

Expected: `FAIL` — `detectMultiDiscGames` not exported.

- [ ] **Step 3.3 — Implement `detectMultiDiscGames`**

Append to `apps/dashboard/lib/recalbox/multidisc-detector.ts` (after `detectDiscInfo`):

```ts
export async function detectMultiDiscGames(
  ssh: SshClientLike,
  system?: string,
): Promise<MultiDiscGame[]> {
  const systemFilter = system
    ? MULTIDISC_SYSTEMS.has(system) ? [system] : []
    : [...MULTIDISC_SYSTEMS]

  if (systemFilter.length === 0) return []

  const rows = db
    .select({ system: games.system, romPath: games.romPath })
    .from(games)
    .where(inArray(games.system, systemFilter))
    .all()

  type Group = { system: string; dir: string; baseName: string; discs: DiscEntry[] }
  const groups = new Map<string, Group>()

  for (const row of rows) {
    if (!row.romPath) continue
    const fileName = pathBasename(row.romPath)
    const dir = dirname(row.romPath)
    const info = detectDiscInfo(fileName)
    if (!info) continue

    const key = `${row.system}\0${dir}\0${info.baseName}`
    let group = groups.get(key)
    if (!group) {
      group = { system: row.system, dir, baseName: info.baseName, discs: [] }
      groups.set(key, group)
    }
    group.discs.push({ fileName, discNumber: info.discNumber })
  }

  const candidates = [...groups.values()].filter((g) => g.discs.length >= 2)
  if (candidates.length === 0) return []

  const uniqueDirs = [...new Set(candidates.map((c) => c.dir))]
  const existingM3uByDir = new Map<string, Set<string>>()

  await Promise.all(
    uniqueDirs.map(async (dir) => {
      try {
        const output = await ssh.exec(
          `ls -1 ${shellQuote(dir)} 2>/dev/null | grep '\\.m3u$' || true`,
        )
        const files = output
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.endsWith('.m3u'))
        existingM3uByDir.set(dir, new Set(files))
      } catch {
        existingM3uByDir.set(dir, new Set())
      }
    }),
  )

  return candidates.map(({ system: sys, dir, baseName, discs }) => {
    const sorted = [...discs].sort((a, b) => a.discNumber - b.discNumber)
    const m3uFileName = sanitizeM3uFileName(baseName)
    const nums = sorted.map((d) => d.discNumber)
    const hasGap = nums.some((n, i) => n !== i + 1)

    return {
      system: sys,
      baseName,
      m3uFileName,
      romsDir: dir,
      discs: sorted,
      m3uAlreadyExists: existingM3uByDir.get(dir)?.has(m3uFileName) ?? false,
      hasGap,
    }
  })
}
```

- [ ] **Step 3.4 — Run all tests**

```bash
cd apps/dashboard && pnpm vitest run lib/recalbox/__tests__/multidisc-detector.test.ts lib/recalbox/__tests__/m3u-generator.test.ts
```

Expected: all tests `PASS`.

- [ ] **Step 3.5 — Commit**

```bash
git add apps/dashboard/lib/recalbox/multidisc-detector.ts \
        apps/dashboard/lib/recalbox/__tests__/multidisc-detector.test.ts
git commit -m "feat(m3u): add detectMultiDiscGames with DB query and SSH m3u check"
```

---

## Task 4: API routes

**Files:**
- Create: `app/api/m3u/candidates/route.ts`
- Create: `app/api/m3u/generate/route.ts`

- [ ] **Step 4.1 — Create `GET /api/m3u/candidates`**

Create `apps/dashboard/app/api/m3u/candidates/route.ts`:

```ts
import { db } from '@/lib/db/index'
import { games } from '@/lib/db/schema'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { detectMultiDiscGames, MULTIDISC_SYSTEMS } from '@/lib/recalbox/multidisc-detector'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const system = req.nextUrl.searchParams.get('system') ?? undefined

  const recalboxId = await getActiveRecalboxId()
  if (!recalboxId) {
    return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
  }

  const ssh = getSshClient(recalboxId)
  const candidates = await detectMultiDiscGames(ssh, system)

  const presentSystems = db
    .select({ system: games.system })
    .from(games)
    .where(inArray(games.system, [...MULTIDISC_SYSTEMS]))
    .all()
    .map((r) => r.system)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .sort()

  return NextResponse.json({ candidates, systems: presentSystems })
}
```

- [ ] **Step 4.2 — Create `POST /api/m3u/generate`**

Create `apps/dashboard/app/api/m3u/generate/route.ts`:

```ts
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { generateM3uContent, sanitizeM3uFileName } from '@/lib/recalbox/m3u-generator'
import type { MultiDiscGame } from '@/lib/recalbox/multidisc-detector'
import { shellQuote } from '@/lib/recalbox/shell'
import { getSshClient } from '@/lib/recalbox/ssh-client'
import { logger } from '@/lib/logger'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type GenerateRequest = {
  recalboxId?: string
  games: Array<
    Pick<MultiDiscGame, 'system' | 'baseName' | 'romsDir' | 'discs'> & { force?: boolean }
  >
}

type GenerateResult = {
  system: string
  baseName: string
  m3uFileName: string
  status: 'created' | 'skipped' | 'error'
  reason?: 'already_identical' | 'already_exists'
  error?: string
}

export async function POST(req: NextRequest) {
  const body: GenerateRequest = await req.json()
  const recalboxId = body.recalboxId ?? (await getActiveRecalboxId())
  if (!recalboxId) {
    return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
  }

  const ssh = getSshClient(recalboxId)
  const results: GenerateResult[] = []

  for (const gameReq of body.games) {
    const { system, baseName, romsDir, discs, force = false } = gameReq
    const m3uFileName = sanitizeM3uFileName(baseName)

    if (!romsDir.startsWith('/recalbox/')) {
      results.push({ system, baseName, m3uFileName, status: 'error', error: 'Invalid romsDir' })
      continue
    }

    const game: MultiDiscGame = {
      system, baseName, m3uFileName, romsDir,
      discs: [...discs].sort((a, b) => a.discNumber - b.discNumber),
      m3uAlreadyExists: false,
      hasGap: false,
    }
    const expectedContent = generateM3uContent(game)
    const m3uPath = `${romsDir}/${m3uFileName}`

    try {
      const existsOutput = await ssh.exec(
        `test -f ${shellQuote(m3uPath)} && echo yes || echo no`,
      )

      if (existsOutput === 'yes' && !force) {
        const existing = await ssh.exec(`cat ${shellQuote(m3uPath)}`)
        const normalised = existing.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const clean = normalised.endsWith('\n') ? normalised : normalised + '\n'

        if (clean === expectedContent) {
          results.push({ system, baseName, m3uFileName, status: 'skipped', reason: 'already_identical' })
          continue
        }
        results.push({ system, baseName, m3uFileName, status: 'skipped', reason: 'already_exists' })
        continue
      }

      const b64 = Buffer.from(expectedContent).toString('base64')
      await ssh.exec(`printf '%s' ${shellQuote(b64)} | base64 -d > ${shellQuote(m3uPath)}`)
      logger.info(`m3u: created ${m3uPath}`)
      results.push({ system, baseName, m3uFileName, status: 'created' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`m3u: failed to write ${m3uPath}`, err)
      results.push({ system, baseName, m3uFileName, status: 'error', error: message })
    }
  }

  const summary = {
    created: results.filter((r) => r.status === 'created').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errors: results.filter((r) => r.status === 'error').length,
  }

  return NextResponse.json({ results, summary })
}
```

- [ ] **Step 4.3 — Verify build compiles**

```bash
cd apps/dashboard && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.4 — Commit**

```bash
git add apps/dashboard/app/api/m3u/
git commit -m "feat(m3u): add GET /api/m3u/candidates and POST /api/m3u/generate routes"
```

---

## Task 5: UI — page + client component

**Files:**
- Create: `app/[locale]/collection/m3u/page.tsx`
- Create: `components/m3u-candidates.tsx`

- [ ] **Step 5.1 — Add i18n keys**

In `apps/dashboard/messages/en.json`, add a top-level `"m3u"` key after `"collection"`:

```json
"m3u": {
  "title": "Multi-disc / .m3u",
  "subtitle": "{games, plural, one {1 game} other {# games}} · {systems, plural, one {1 system} other {# systems}} · {missing, plural, =0 {all .m3u present} one {1 missing} other {# missing}}",
  "generateMissing": "Generate missing",
  "generating": "Generating…",
  "discs": "{count} discs",
  "status": {
    "ok": ".m3u OK",
    "missing": "Missing",
    "gap": "Gap in discs",
    "differs": "Content differs"
  },
  "actions": {
    "generate": "Generate",
    "update": "Update",
    "confirmUpdate": "Confirm update",
    "cancel": "Cancel"
  },
  "preview": "Preview .m3u",
  "rescanNote": "A re-scan in EmulationStation may be needed for .m3u files to appear in Recalbox.",
  "noGames": "No multi-disc games detected. Sync your collection first.",
  "breadcrumb": "Collection",
  "diffCurrent": "Current content",
  "diffExpected": "New content"
}
```

In `apps/dashboard/messages/fr.json`, add after `"collection"`:

```json
"m3u": {
  "title": "Multi-disques / .m3u",
  "subtitle": "{games, plural, one {1 jeu} other {# jeux}} · {systems, plural, one {1 système} other {# systèmes}} · {missing, plural, =0 {tous les .m3u présents} one {1 manquant} other {# manquants}}",
  "generateMissing": "Générer les manquants",
  "generating": "Génération…",
  "discs": "{count} disques",
  "status": {
    "ok": ".m3u OK",
    "missing": "Manquant",
    "gap": "Trou dans les disques",
    "differs": "Contenu différent"
  },
  "actions": {
    "generate": "Générer",
    "update": "Mettre à jour",
    "confirmUpdate": "Confirmer la mise à jour",
    "cancel": "Annuler"
  },
  "preview": "Aperçu .m3u",
  "rescanNote": "Un re-scan EmulationStation peut être nécessaire pour que les .m3u apparaissent dans Recalbox.",
  "noGames": "Aucun jeu multi-disques détecté. Synchronisez votre collection d'abord.",
  "breadcrumb": "Collection",
  "diffCurrent": "Contenu actuel",
  "diffExpected": "Nouveau contenu"
}
```

- [ ] **Step 5.2 — Create the page server component**

Create `apps/dashboard/app/[locale]/collection/m3u/page.tsx`:

```tsx
import { M3uCandidates } from '@/components/m3u-candidates'
import { Separator } from '@/components/ui/separator'
import { Link } from '@/i18n/navigation'
import type { routing } from '@/i18n/routing'
import { ChevronRight } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ locale: string }> }

export default async function M3uPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale as (typeof routing.locales)[number])
  const t = await getTranslations('m3u')

  return (
    <div className="container mx-auto max-w-screen-2xl space-y-6 px-4 py-8">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/collection" className="hover:text-foreground">
          {t('breadcrumb')}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-foreground">{t('title')}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </div>

      <Separator />

      <M3uCandidates />
    </div>
  )
}
```

- [ ] **Step 5.3 — Create the client component**

Create `apps/dashboard/components/m3u-candidates.tsx`:

```tsx
'use client'

import type { MultiDiscGame } from '@/lib/recalbox/multidisc-detector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertTriangle, CheckCircle2, CircleDotDashed, FileText, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type CandidatesData = { candidates: MultiDiscGame[]; systems: string[] }

type GenerateEntry = Pick<MultiDiscGame, 'system' | 'baseName' | 'romsDir' | 'discs'>

type ConfirmState = {
  game: MultiDiscGame
  currentContent: string
  expectedContent: string
} | null

function gameStatus(g: MultiDiscGame): 'ok' | 'missing' | 'gap' | 'differs' {
  if (!g.m3uAlreadyExists) return g.hasGap ? 'gap' : 'missing'
  return 'ok'
}

function m3uPreview(g: MultiDiscGame): string {
  return g.discs.map((d) => d.fileName).join('\n') + '\n'
}

export function M3uCandidates() {
  const t = useTranslations('m3u')
  const [data, setData] = useState<CandidatesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generatingKeys, setGeneratingKeys] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [banner, setBanner] = useState(false)

  useEffect(() => {
    fetch('/api/m3u/candidates')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  const gameKey = (g: MultiDiscGame) => `${g.system}|${g.romsDir}|${g.baseName}`

  const generate = async (games: GenerateEntry[], force = false) => {
    const keys = games.map((g) => `${g.system}|${g.romsDir}|${g.baseName}`)
    setGeneratingKeys((prev) => new Set([...prev, ...keys]))

    const res = await fetch('/api/m3u/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: games.map((g) => ({ ...g, force })) }),
    }).then((r) => r.json())

    // Refresh candidates
    const fresh: CandidatesData = await fetch('/api/m3u/candidates').then((r) => r.json())
    setData(fresh)
    setGeneratingKeys(new Set())

    if (res.summary.created > 0) setBanner(true)
    return res
  }

  const handleUpdate = async (g: MultiDiscGame) => {
    const currentContent = await fetch('/api/m3u/candidates').then(() => '')
    setConfirm({
      game: g,
      currentContent: '(existing content on Recalbox)',
      expectedContent: m3uPreview(g),
    })
  }

  const batchMissing = () => {
    if (!data) return
    const missing = data.candidates.filter((g) => !g.m3uAlreadyExists)
    generate(missing)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (!data || data.candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('noGames')}</p>
    )
  }

  const totalMissing = data.candidates.filter((g) => !g.m3uAlreadyExists).length
  const bySystem = Map.groupBy(data.candidates, (g) => g.system)

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Summary bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {t('subtitle', {
              games: data.candidates.length,
              systems: bySystem.size,
              missing: totalMissing,
            })}
          </p>
          {totalMissing > 0 && (
            <Button onClick={batchMissing} disabled={generatingKeys.size > 0}>
              {generatingKeys.size > 0 ? t('generating') : t('generateMissing')}
            </Button>
          )}
        </div>

        {/* Per-system sections */}
        {[...bySystem.entries()].map(([system, sysGames]) => {
          const sysMissing = sysGames.filter((g) => !g.m3uAlreadyExists).length
          return (
            <div key={system} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold capitalize">{system}</h2>
                <span className="text-sm text-muted-foreground">
                  {sysGames.length} games · {sysMissing} missing
                </span>
              </div>

              <div className="rounded-md border divide-y">
                {sysGames.map((g) => {
                  const status = gameStatus(g)
                  const key = gameKey(g)
                  const isGenerating = generatingKeys.has(key)
                  const preview = m3uPreview(g)

                  return (
                    <div key={key} className="flex items-center gap-3 px-4 py-2">
                      {/* Status icon */}
                      <span className="shrink-0">
                        {status === 'ok' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                        {status === 'missing' && <XCircle className="h-4 w-4 text-amber-500" />}
                        {status === 'gap' && (
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertTriangle className="h-4 w-4 text-orange-500" />
                            </TooltipTrigger>
                            <TooltipContent>{t('status.gap')}</TooltipContent>
                          </Tooltip>
                        )}
                        {status === 'differs' && <CircleDotDashed className="h-4 w-4 text-blue-500" />}
                      </span>

                      {/* Game name */}
                      <span className="flex-1 text-sm truncate">{g.baseName}</span>

                      {/* Disc count */}
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {t('discs', { count: g.discs.length })}
                      </Badge>

                      {/* Status badge */}
                      <Badge
                        variant={status === 'ok' ? 'secondary' : 'outline'}
                        className="shrink-0 text-xs"
                      >
                        {t(`status.${status}`)}
                      </Badge>

                      {/* Preview popover */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                            <FileText className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto max-w-sm">
                          <pre className="text-xs font-mono whitespace-pre">{preview}</pre>
                        </PopoverContent>
                      </Popover>

                      {/* Action button */}
                      {status !== 'ok' && (
                        <Button
                          size="sm"
                          variant={status === 'differs' ? 'outline' : 'default'}
                          className="shrink-0"
                          disabled={isGenerating}
                          onClick={() =>
                            status === 'differs'
                              ? handleUpdate(g)
                              : generate([g])
                          }
                        >
                          {isGenerating
                            ? t('generating')
                            : status === 'differs'
                            ? t('actions.update')
                            : t('actions.generate')}
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Re-scan banner */}
        {banner && (
          <p className="text-sm text-muted-foreground border rounded-md px-4 py-3">
            {t('rescanNote')}
          </p>
        )}

        {/* Confirm overwrite dialog */}
        <Dialog open={confirm !== null} onOpenChange={() => setConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('actions.confirmUpdate')}</DialogTitle>
            </DialogHeader>
            {confirm && (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium mb-1">{t('diffExpected')}</p>
                  <pre className="rounded bg-muted px-3 py-2 text-xs font-mono whitespace-pre">
                    {confirm.expectedContent}
                  </pre>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)}>
                {t('actions.cancel')}
              </Button>
              <Button
                onClick={() => {
                  if (confirm) {
                    generate([confirm.game], true)
                    setConfirm(null)
                  }
                }}
              >
                {t('actions.confirmUpdate')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 5.4 — Verify TypeScript**

```bash
cd apps/dashboard && pnpm tsc --noEmit
```

Expected: no errors. Fix any import issues if they arise.

- [ ] **Step 5.5 — Commit**

```bash
git add apps/dashboard/app/\[locale\]/collection/m3u/ \
        apps/dashboard/components/m3u-candidates.tsx \
        apps/dashboard/messages/en.json \
        apps/dashboard/messages/fr.json
git commit -m "feat(m3u): add collection/m3u page and M3uCandidates component"
```

---

## Task 6: Wire navigation + final checks

**Files:**
- Modify: `app/[locale]/collection/page.tsx`

- [ ] **Step 6.1 — Add navigation button to the collection page**

In `apps/dashboard/app/[locale]/collection/page.tsx`, add the import and the button.

Add import at the top:

```tsx
import { Link } from '@/i18n/navigation'
import { Disc3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
```

In the header `div` where `SyncButton` lives, add the M3U link next to it:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <Button variant="outline" size="sm" asChild>
    <Link href="/collection/m3u">
      <Disc3 className="h-4 w-4 mr-2" />
      Multi-disc / .m3u
    </Link>
  </Button>
  <SyncButton />
</div>
```

- [ ] **Step 6.2 — Run full test suite**

```bash
cd apps/dashboard && pnpm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 6.3 — Build check**

```bash
pnpm build
```

Expected: build succeeds with no type errors.

- [ ] **Step 6.4 — Start dev server and verify UI manually**

```bash
pnpm dev
```

Open `http://localhost:3000/collection`. Verify:

1. "Multi-disc / .m3u" button appears in the collection header
2. Clicking it navigates to `/collection/m3u`
3. Skeleton appears while candidates load
4. Games are grouped by system
5. Status icons are correct (✓ for existing .m3u, ⚠ for missing)
6. Preview popover shows correct filenames on hover
7. "Generate" on a missing game creates the .m3u (verify via SSH: `ls /recalbox/share/.../psx/*.m3u`)
8. "Generate missing" batch works
9. Re-scan banner appears after generation

- [ ] **Step 6.5 — Final commit**

```bash
git add apps/dashboard/app/\[locale\]/collection/page.tsx
git commit -m "feat(m3u): multi-disc detection and .m3u generation"
```

---

## Self-review checklist

- [x] **Types**: `DiscEntry` and `MultiDiscGame` defined in Task 1 stub, completed in Task 2. Used consistently across all tasks.
- [x] **`sanitizeM3uFileName`**: defined in `m3u-generator.ts` (Task 1), imported in `multidisc-detector.ts` (Task 3). No circular dependency — generator imports types from detector, detector imports generator helper.
- [x] **LF enforcement**: `generateM3uContent` uses `\n` join; tests explicitly assert no `\r`.
- [x] **No silent overwrite**: generate route returns `skipped/already_exists` when content differs without `force`; UI requires confirmation dialog for updates.
- [x] **baseName = prefix before disc tag**: implemented in `detectDiscInfo` via `stem.slice(0, match.index).trimEnd()`. Test cases include Biohazard 2 qualifier case.
- [x] **SSH path safety**: `romsDir` validated to start with `/recalbox/` in generate route; all paths wrapped with `shellQuote()`.
- [x] **i18n**: both `en.json` and `fr.json` updated in Task 5.
- [x] **`Map.groupBy`**: available in Node.js 21+ / recent V8. If not available, replace with: `data.candidates.reduce((acc, g) => { const k = g.system; (acc[k] ??= []).push(g); return acc }, {} as Record<string, MultiDiscGame[]>)`.
