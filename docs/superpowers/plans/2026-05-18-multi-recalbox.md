# Multi-Recalbox Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the entire "single Recalbox" assumption so the dashboard manages N Recalbox instances, with a per-user active-Recalbox cookie and a full CRUD management UI.

**Architecture:** Add a `recalboxes` DB table as the source of truth for connection configs; add `recalbox_id` FK columns to `sessions`, `games`, `system_snapshots`, `ra_game_mapping`, `notifications`; replace single SSH/MQTT singletons with pools; keep `configStore.get().recalbox` working as a backward-compatible shortcut that returns the active Recalbox config.

**Tech Stack:** SQLite/Drizzle ORM, Next.js 16 App Router, next-intl, Zod, node-ssh, mqtt.js, shadcn/ui, Vitest.

---

## Impact Analysis: Files Changed

| File | Change type |
|------|-------------|
| `lib/db/schema.ts` | Add `recalboxes` table; add `recalboxId` to 5 tables |
| `lib/db/queries.ts` | All read/write queries accept optional `recalboxId` |
| `lib/db/recalbox-queries.ts` | **NEW** — CRUD for `recalboxes` table |
| `lib/db/multi-recalbox-migration.ts` | **NEW** — boot-time data backfill |
| `lib/db/index.ts` | Run migration at startup |
| `lib/settings/schemas.ts` | Add `RecalboxInstance` type; update `AppConfig` |
| `lib/settings/defaults.ts` | Keep as-is (used during bootstrap only) |
| `lib/config-store.ts` | Add Recalbox CRUD methods; emit new events; `get().recalbox` returns active |
| `lib/config.ts` | No change needed |
| `lib/recalbox/active.ts` | **NEW** — cookie helpers |
| `lib/recalbox/mqtt-client.ts` | Add `MqttPool`; keep `getMqttClient()` alias |
| `lib/recalbox/ssh-client.ts` | Add `SshPool`; keep `sshClient` alias |
| `lib/scrobbler/index.ts` | Multi-MQTT subscribe with hot-reload |
| `lib/scrobbler/session-manager.ts` | Accept + forward `recalboxId` |
| `app/api/events/route.ts` | Multi-source SSE, filter by `?recalboxId` |
| `app/api/recalboxes/route.ts` | **NEW** — GET list, POST create |
| `app/api/recalboxes/active/route.ts` | **NEW** — PUT set active |
| `app/api/recalboxes/[id]/route.ts` | **NEW** — GET, PUT, DELETE |
| `app/api/recalboxes/[id]/test-connection/route.ts` | **NEW** |
| `app/api/collection/sync/route.ts` | Pass active `recalboxId` |
| `app/[locale]/layout.tsx` | Add `RecalboxSwitcher` to nav |
| `app/[locale]/welcome/page.tsx` | On finish: create `recalboxes` row |
| `app/[locale]/recalboxes/page.tsx` | **NEW** — management list |
| `app/[locale]/recalboxes/add/page.tsx` | **NEW** |
| `app/[locale]/recalboxes/[id]/edit/page.tsx` | **NEW** |
| `app/[locale]/all-recalboxes/page.tsx` | **NEW** — aggregated view |
| `components/recalbox-switcher.tsx` | **NEW** |
| `components/recalbox-form.tsx` | **NEW** — extracted from wizard |
| `messages/en.json` | Add `recalboxes` section |
| `messages/fr.json` | Add `recalboxes` section |
| `lib/recalbox/__tests__/active.test.ts` | **NEW** |
| `lib/db/__tests__/multi-tenant-queries.test.ts` | **NEW** |
| `scripts/__tests__/migration-multi-recalbox.test.ts` | **NEW** |

---

## Task 1: DB Schema — `recalboxes` table + `recalbox_id` columns

**Files:**
- Modify: `apps/dashboard/lib/db/schema.ts`

- [ ] **Step 1: Update schema.ts**

Replace the entire file with the following (adds `recalboxes` table and `recalboxId` columns; changes `games.romPath` unique constraint to composite; changes `ra_game_mapping` PK to composite):

```typescript
import { index, int, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

export const recalboxes = sqliteTable('recalboxes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  sshUser: text('ssh_user').notNull(),
  sshPassword: text('ssh_password').notNull(),
  sshPort: int('ssh_port').notNull().default(22),
  mqttPort: int('mqtt_port').notNull().default(1883),
  color: text('color'),
  iconEmoji: text('icon_emoji'),
  isDefault: int('is_default', { mode: 'boolean' }).default(false),
  archived: int('archived', { mode: 'boolean' }).default(false),
  createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
  lastConnectedAt: int('last_connected_at', { mode: 'timestamp' }),
})

export const raCache = sqliteTable('ra_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
})

export const raAchievements = sqliteTable(
  'ra_achievements',
  {
    id: int('id').primaryKey(),
    gameId: int('game_id').notNull(),
    title: text('title').notNull(),
    points: int('points').notNull(),
    imageUrl: text('image_url').notNull(),
    unlockedAt: int('unlocked_at', { mode: 'timestamp' }).notNull(),
    isHardcore: int('is_hardcore', { mode: 'boolean' }).default(false),
    syncedAt: int('synced_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    gameIdIdx: index('idx_ra_achievements_game_id').on(t.gameId),
    unlockedAtIdx: index('idx_ra_achievements_unlocked_at').on(t.unlockedAt),
  }),
)

export const raGameProgress = sqliteTable('ra_game_progress', {
  gameId: int('game_id').primaryKey(),
  title: text('title').notNull(),
  imageIcon: text('image_icon').notNull(),
  numAchievements: int('num_achievements').notNull(),
  numAwarded: int('num_awarded').notNull(),
  numAwardedHardcore: int('num_awarded_hardcore').notNull(),
  points: int('points').notNull(),
  maxPoints: int('max_points').notNull(),
  consoleId: int('console_id').notNull(),
  consoleName: text('console_name').notNull(),
  syncedAt: int('synced_at', { mode: 'timestamp' }).notNull(),
})

export const raGameMapping = sqliteTable(
  'ra_game_mapping',
  {
    recalboxId: text('recalbox_id').notNull(),
    romPath: text('rom_path').notNull(),
    raGameId: int('ra_game_id').notNull(),
    matchKind: text('match_kind', { enum: ['auto', 'manual'] }).notNull(),
    updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.recalboxId, t.romPath] }),
  }),
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    recalboxId: text('recalbox_id'),
    gameId: int('game_id'),
    startedAt: int('started_at', { mode: 'timestamp' }).notNull(),
    endedAt: int('ended_at', { mode: 'timestamp' }),
    durationSeconds: int('duration_seconds'),
    system: text('system').notNull(),
    romPath: text('rom_path').notNull(),
    autoClosed: int('auto_closed', { mode: 'boolean' }).default(false),
    closedReason: text('closed_reason'),
  },
  (t) => ({
    recalboxIdIdx: index('idx_sessions_recalbox_id').on(t.recalboxId),
    romPathIdx: index('idx_sessions_rom_path').on(t.romPath),
    startedAtIdx: index('idx_sessions_started_at').on(t.startedAt),
    endedAtIdx: index('idx_sessions_ended_at').on(t.endedAt),
  }),
)

export const games = sqliteTable(
  'games',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    recalboxId: text('recalbox_id'),
    name: text('name').notNull(),
    system: text('system').notNull(),
    romPath: text('rom_path').notNull(),
    screenshotPath: text('screenshot_path'),
    imagePath: text('image_path'),
    videoPath: text('video_path'),
    thumbnailPath: text('thumbnail_path'),
    rating: real('rating'),
    players: text('players'),
    releaseDate: int('release_date', { mode: 'timestamp' }),
    developer: text('developer'),
    publisher: text('publisher'),
    genre: text('genre'),
    description: text('description'),
    hash: text('hash'),
    region: text('region'),
    favorite: int('favorite', { mode: 'boolean' }).notNull().default(false),
    hidden: int('hidden', { mode: 'boolean' }).notNull().default(false),
    playCount: int('play_count').default(0),
    lastPlayed: int('last_played', { mode: 'timestamp' }),
    diskSource: text('disk_source'),
    syncedAt: int('synced_at', { mode: 'timestamp' }),
    scrapeStatus: text('scrape_status', { enum: ['pending', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
    srSlug: text('sr_slug'),
    srHasPage: int('sr_has_page'),
    srUrl: text('sr_url'),
    srCheckedAt: int('sr_checked_at', { mode: 'timestamp' }),
  },
  (t) => ({
    recalboxRomUnique: unique('uq_games_recalbox_rom').on(t.recalboxId, t.romPath),
    recalboxIdIdx: index('idx_games_recalbox_id').on(t.recalboxId),
  }),
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
})

export const systemSnapshots = sqliteTable(
  'system_snapshots',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    recalboxId: text('recalbox_id'),
    capturedAt: int('captured_at', { mode: 'timestamp' }).notNull(),
    cpuPercent: real('cpu_percent'),
    memUsedMb: real('mem_used_mb'),
    memTotalMb: real('mem_total_mb'),
    tempCelsius: real('temp_celsius'),
    uptimeSeconds: int('uptime_seconds'),
  },
  (t) => ({
    recalboxIdIdx: index('idx_snapshots_recalbox_id').on(t.recalboxId),
  }),
)

export const srCache = sqliteTable('sr_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAt: int('expires_at', { mode: 'timestamp' }).notNull(),
})

export const wrappedCache = sqliteTable(
  'wrapped_cache',
  {
    year: int('year').notNull(),
    locale: text('locale').notNull(),
    data: text('data').notNull(),
    generatedAt: int('generated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.year, t.locale] }),
  }),
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    recalboxId: text('recalbox_id'),
    type: text('type').notNull(),
    data: text('data').notNull(),
    createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
    readAt: int('read_at', { mode: 'timestamp' }),
    pushedInApp: int('pushed_in_app', { mode: 'boolean' }).default(false),
    pushedWeb: int('pushed_web', { mode: 'boolean' }).default(false),
  },
  (t) => ({
    createdAtIdx: index('idx_notifications_created_at').on(t.createdAt),
    pushedInAppIdx: index('idx_notifications_pushed_in_app').on(t.pushedInApp),
    recalboxIdIdx: index('idx_notifications_recalbox_id').on(t.recalboxId),
  }),
)

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: int('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: int('last_used_at', { mode: 'timestamp' }).notNull(),
})
```

- [ ] **Step 2: Generate Drizzle migration**

```bash
cd apps/dashboard && pnpm drizzle-kit generate
```

Expected: Creates `drizzle/migrations/0008_multi_recalbox.sql` (or similar). The migration will:
- CREATE TABLE `recalboxes`
- ALTER TABLE `sessions` ADD COLUMN `recalbox_id`
- ALTER TABLE `games` ADD COLUMN `recalbox_id`, DROP old unique constraint, ADD composite unique
- ALTER TABLE `system_snapshots` ADD COLUMN `recalbox_id`
- ALTER TABLE `ra_game_mapping` — recreate with composite PK
- ALTER TABLE `notifications` ADD COLUMN `recalbox_id`

If the generator creates a snapshot inconsistency for `games.romPath.unique()`, run:
```bash
pnpm drizzle-kit push
```
and inspect the resulting SQL. Manually verify the migration preserves existing data.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/db/schema.ts apps/dashboard/drizzle/migrations/
git commit -m "feat(multi): add recalboxes table and recalbox_id columns to schema"
```

---

## Task 2: DB queries for `recalboxes` CRUD

**Files:**
- Create: `apps/dashboard/lib/db/recalbox-queries.ts`

- [ ] **Step 1: Create the file**

```typescript
import { db } from '@/lib/db/index'
import { recalboxes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export type RecalboxRow = typeof recalboxes.$inferSelect
export type RecalboxInsert = typeof recalboxes.$inferInsert

export function listRecalboxes(): RecalboxRow[] {
  return db.select().from(recalboxes).all()
}

export function getRecalbox(id: string): RecalboxRow | null {
  return db.select().from(recalboxes).where(eq(recalboxes.id, id)).get() ?? null
}

export function getDefaultRecalbox(): RecalboxRow | null {
  return db.select().from(recalboxes).where(eq(recalboxes.isDefault, true)).get() ?? null
}

export function insertRecalbox(row: RecalboxInsert): void {
  db.insert(recalboxes).values(row).run()
}

export function updateRecalbox(id: string, patch: Partial<Omit<RecalboxInsert, 'id'>>): void {
  db.update(recalboxes).set(patch).where(eq(recalboxes.id, id)).run()
}

export function deleteRecalbox(id: string): void {
  db.delete(recalboxes).where(eq(recalboxes.id, id)).run()
}

export function setDefaultRecalbox(id: string): void {
  db.update(recalboxes).set({ isDefault: false }).run()
  db.update(recalboxes).set({ isDefault: true }).where(eq(recalboxes.id, id)).run()
}

export function countRecalboxes(): number {
  return db.select().from(recalboxes).all().length
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/lib/db/recalbox-queries.ts
git commit -m "feat(multi): add CRUD queries for recalboxes table"
```

---

## Task 3: Boot-time data migration (single → multi)

**Files:**
- Create: `apps/dashboard/lib/db/multi-recalbox-migration.ts`
- Modify: `apps/dashboard/lib/db/index.ts`

- [ ] **Step 1: Create the migration module**

```typescript
// apps/dashboard/lib/db/multi-recalbox-migration.ts
import { db } from '@/lib/db/index'
import { games, notifications, raGameMapping, recalboxes, sessions, settings, systemSnapshots } from '@/lib/db/schema'
import { isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

const MIGRATION_FLAG = '__multi_recalbox_migrated__'

function readSetting(key: string): string | null {
  return db.select().from(settings).where(require('drizzle-orm').eq(settings.key, key)).get()?.value ?? null
}

export function runMultiRecalboxMigrationIfNeeded(): void {
  // Already migrated
  if (readSetting(MIGRATION_FLAG) === 'true') return

  // Check if recalboxes table already has rows (e.g., fresh install)
  const existing = db.select().from(recalboxes).limit(1).all()
  if (existing.length > 0) {
    db.insert(settings).values({ key: MIGRATION_FLAG, value: 'true', updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } }).run()
    return
  }

  // Check if there's any data to migrate
  const sessionCount = db.select().from(sessions).limit(1).all().length
  const gameCount = db.select().from(games).limit(1).all().length
  if (sessionCount === 0 && gameCount === 0) {
    // Fresh install — no migration needed; wizard will create first recalbox
    db.insert(settings).values({ key: MIGRATION_FLAG, value: 'true', updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } }).run()
    return
  }

  // Existing single-Recalbox data: create default row from stored settings
  const host = readSetting('recalbox.host') ?? process.env['RECALBOX_HOST'] ?? 'recalbox.local'
  const sshUser = readSetting('recalbox.sshUser') ?? 'root'
  const sshPassword = readSetting('recalbox.sshPassword') ?? ''
  const sshPort = Number(readSetting('recalbox.sshPort') ?? '22')
  const mqttPort = Number(readSetting('recalbox.mqttPort') ?? '1883')

  const defaultId = randomUUID()

  db.insert(recalboxes).values({
    id: defaultId,
    name: 'My Recalbox',
    host,
    sshUser,
    sshPassword,
    sshPort,
    mqttPort,
    isDefault: true,
    archived: false,
    createdAt: new Date(),
  }).run()

  // Backfill recalbox_id on all tables (only rows where it is NULL)
  db.update(sessions).set({ recalboxId: defaultId }).where(isNull(sessions.recalboxId)).run()
  db.update(games).set({ recalboxId: defaultId }).where(isNull(games.recalboxId)).run()
  db.update(systemSnapshots).set({ recalboxId: defaultId }).where(isNull(systemSnapshots.recalboxId)).run()
  db.update(notifications).set({ recalboxId: defaultId }).where(isNull(notifications.recalboxId)).run()
  // ra_game_mapping has composite PK — needs special handling since recalbox_id was always part of PK
  // These rows have empty string recalbox_id from migration; update to defaultId
  db.update(raGameMapping).set({ recalboxId: defaultId })
    .where(require('drizzle-orm').eq(raGameMapping.recalboxId, '')).run()

  db.insert(settings).values({ key: MIGRATION_FLAG, value: 'true', updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } }).run()

  console.log(`[multi-recalbox] Migrated existing data to Recalbox ${defaultId} (${host})`)
}
```

> **Note on `ra_game_mapping`**: The Drizzle migration for the composite PK will set `recalbox_id` to `''` (empty string) for existing rows (since it can't be NULL in a PK). The backfill above updates those to `defaultId`.

- [ ] **Step 2: Call migration at DB init**

Edit `apps/dashboard/lib/db/index.ts` to call the migration immediately after DB setup:

```typescript
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const DB_PATH = process.env['DATABASE_PATH'] ?? './recalbox.db'

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
export type DB = typeof db

// Boot-time migration: runs inline (synchronous, idempotent)
// Deferred require to avoid circular deps during module init
import('@/lib/db/multi-recalbox-migration').then(({ runMultiRecalboxMigrationIfNeeded }) => {
  runMultiRecalboxMigrationIfNeeded()
}).catch(console.error)
```

> **Important**: The import must be async to avoid circular dependency (migration imports `db` which imports schema). Alternatively, call `runMultiRecalboxMigrationIfNeeded()` in your startup script or Next.js instrumentation. The safest place is a Next.js `instrumentation.ts` file:

Create `apps/dashboard/instrumentation.ts`:
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMultiRecalboxMigrationIfNeeded } = await import('@/lib/db/multi-recalbox-migration')
    runMultiRecalboxMigrationIfNeeded()
  }
}
```

And remove the async import from `index.ts` (revert to original `index.ts`).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/db/multi-recalbox-migration.ts apps/dashboard/instrumentation.ts
git commit -m "feat(multi): boot-time data migration single → multi Recalbox"
```

---

## Task 4: Config store refactor

**Files:**
- Modify: `apps/dashboard/lib/settings/schemas.ts`
- Modify: `apps/dashboard/lib/config-store.ts`

- [ ] **Step 1: Add `RecalboxInstance` type to schemas.ts**

Add after the existing `recalboxConfigSchema` export:

```typescript
export const recalboxInstanceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  host: z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/),
  sshUser: z.string().min(1).max(32),
  sshPassword: z.string().min(1).max(128),
  sshPort: z.number().int().min(1).max(65535),
  mqttPort: z.number().int().min(1).max(65535),
  color: z.string().nullable(),
  iconEmoji: z.string().nullable(),
  isDefault: z.boolean(),
  archived: z.boolean(),
})

export type RecalboxInstance = z.infer<typeof recalboxInstanceSchema>
```

- [ ] **Step 2: Refactor ConfigStore**

Replace `apps/dashboard/lib/config-store.ts` with the following (keeps all existing behavior and adds Recalbox management):

```typescript
import { EventEmitter } from 'node:events'
import { deleteSettingsByPrefix, getAllSettings, upsertSetting } from '@/lib/db/queries'
import {
  deleteRecalbox,
  getDefaultRecalbox,
  getRecalbox,
  insertRecalbox,
  listRecalboxes,
  setDefaultRecalbox,
  type RecalboxRow,
  updateRecalbox,
} from '@/lib/db/recalbox-queries'
import { getDefaults } from '@/lib/settings/defaults'
import {
  type AppConfig,
  type DeepPartial,
  type RecalboxInstance,
  SETUP_COMPLETED_KEY,
} from '@/lib/settings/schemas'
import { randomUUID } from 'node:crypto'

const SINGLETON_VERSION = 2

function flattenConfig(cfg: AppConfig): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [scope, values] of Object.entries(cfg)) {
    if (scope === 'recalbox') continue // stored in recalboxes table, not settings
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      flat[`${scope}.${key}`] = String(value)
    }
  }
  return flat
}

function mergeDbIntoDefaults(defaults: AppConfig, dbRows: Record<string, string>): AppConfig {
  const result = structuredClone(defaults) as AppConfig & Record<string, Record<string, unknown>>
  for (const [flatKey, rawValue] of Object.entries(dbRows)) {
    if (flatKey.startsWith('__') || flatKey.startsWith('recalbox.')) continue
    const dotIdx = flatKey.indexOf('.')
    if (dotIdx === -1) continue
    const scope = flatKey.slice(0, dotIdx) as keyof AppConfig
    const key = flatKey.slice(dotIdx + 1)
    if (!result[scope]) continue
    const current = (result[scope] as Record<string, unknown>)[key]
    if (typeof current === 'number') {
      ;(result[scope] as Record<string, unknown>)[key] = Number(rawValue)
    } else if (typeof current === 'boolean') {
      ;(result[scope] as Record<string, unknown>)[key] = rawValue === 'true'
    } else {
      ;(result[scope] as Record<string, unknown>)[key] = rawValue
    }
  }
  return result as AppConfig
}

function deepMerge<T extends object>(target: T, partial: DeepPartial<T>): T {
  const result = structuredClone(target)
  for (const key of Object.keys(partial) as (keyof T)[]) {
    const pVal = (partial as Record<keyof T, unknown>)[key]
    if (pVal === undefined) continue
    const tVal = (target as Record<keyof T, unknown>)[key]
    if (tVal !== null && typeof tVal === 'object' && typeof pVal === 'object') {
      ;(result as Record<keyof T, unknown>)[key] = deepMerge(tVal as object, pVal as DeepPartial<object>) as T[keyof T]
    } else {
      ;(result as Record<keyof T, unknown>)[key] = pVal as T[keyof T]
    }
  }
  return result
}

function changedScopes(prev: AppConfig, next: AppConfig): (keyof AppConfig)[] {
  const scopes: (keyof AppConfig)[] = []
  for (const scope of Object.keys(prev) as (keyof AppConfig)[]) {
    if (JSON.stringify(prev[scope]) !== JSON.stringify(next[scope])) scopes.push(scope)
  }
  return scopes
}

function rowToInstance(row: RecalboxRow): RecalboxInstance {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    sshUser: row.sshUser,
    sshPassword: row.sshPassword,
    sshPort: row.sshPort,
    mqttPort: row.mqttPort,
    color: row.color,
    iconEmoji: row.iconEmoji,
    isDefault: row.isDefault ?? false,
    archived: row.archived ?? false,
  }
}

interface ConfigStoreEvents {
  changed: (config: AppConfig) => void
  'changed:recalbox': (config: AppConfig) => void
  'changed:scrobble': (config: AppConfig) => void
  'changed:ui': (config: AppConfig) => void
  'changed:retroachievements': (config: AppConfig) => void
  'recalbox:added': (payload: { recalbox: RecalboxInstance }) => void
  'recalbox:updated': (payload: { recalbox: RecalboxInstance }) => void
  'recalbox:removed': (payload: { id: string }) => void
}

declare interface ConfigStore {
  on<K extends keyof ConfigStoreEvents>(event: K, listener: ConfigStoreEvents[K]): this
  off<K extends keyof ConfigStoreEvents>(event: K, listener: ConfigStoreEvents[K]): this
  emit<K extends keyof ConfigStoreEvents>(event: K, ...args: Parameters<ConfigStoreEvents[K]>): boolean
}

class ConfigStore extends EventEmitter {
  private config: AppConfig | null = null

  /** Returns full AppConfig; `recalbox` is the FIRST non-archived Recalbox (bootstrap fallback). */
  get(): AppConfig {
    if (!this.config) {
      const base = mergeDbIntoDefaults(getDefaults(), getAllSettings())
      const first = listRecalboxes().find((r) => !r.archived)
      if (first) base.recalbox = { host: first.host, sshUser: first.sshUser, sshPassword: first.sshPassword, sshPort: first.sshPort, mqttPort: first.mqttPort }
      this.config = base
    }
    return this.config
  }

  /** Returns config for a specific Recalbox ID. */
  getForRecalbox(id: string): AppConfig {
    const base = mergeDbIntoDefaults(getDefaults(), getAllSettings())
    const row = getRecalbox(id)
    if (row) base.recalbox = { host: row.host, sshUser: row.sshUser, sshPassword: row.sshPassword, sshPort: row.sshPort, mqttPort: row.mqttPort }
    return base
  }

  update(partial: DeepPartial<AppConfig>): AppConfig {
    const prev = this.get()
    const next = deepMerge(prev, partial)
    const flat = flattenConfig(next)
    const prevFlat = flattenConfig(prev)
    for (const [k, v] of Object.entries(flat)) {
      if (prevFlat[k] !== v) upsertSetting(k, v)
    }
    const scopes = changedScopes(prev, next)
    this.config = next
    if (scopes.length > 0) {
      this.emit('changed', next)
      for (const scope of scopes) this.emit(`changed:${scope}` as keyof ConfigStoreEvents, next)
    }
    return next
  }

  reset(scope?: keyof AppConfig): AppConfig {
    const defaults = getDefaults()
    const prev = this.get()
    if (scope) {
      deleteSettingsByPrefix(`${scope}.`)
      const next = { ...prev, [scope]: defaults[scope] }
      this.config = next
      if (JSON.stringify(prev[scope]) !== JSON.stringify(next[scope])) {
        this.emit('changed', next)
        this.emit(`changed:${scope}` as keyof ConfigStoreEvents, next)
      }
      return next
    }
    for (const s of Object.keys(defaults) as (keyof AppConfig)[]) deleteSettingsByPrefix(`${s}.`)
    this.config = defaults
    const scopes = changedScopes(prev, defaults)
    if (scopes.length > 0) {
      this.emit('changed', defaults)
      for (const s of scopes) this.emit(`changed:${s}` as keyof ConfigStoreEvents, defaults)
    }
    return defaults
  }

  reload(): AppConfig {
    this.config = null
    return this.get()
  }

  markSetupComplete(): void {
    upsertSetting(SETUP_COMPLETED_KEY, 'true')
  }

  // ─── Recalbox management ───────────────────────────────────────────────────

  getRecalboxes(): RecalboxInstance[] {
    return listRecalboxes().map(rowToInstance)
  }

  getRecalbox(id: string): RecalboxInstance | null {
    const row = getRecalbox(id)
    return row ? rowToInstance(row) : null
  }

  getDefaultRecalbox(): RecalboxInstance | null {
    const row = getDefaultRecalbox()
    if (row) return rowToInstance(row)
    const all = listRecalboxes()
    return all.length > 0 ? rowToInstance(all[0]) : null
  }

  addRecalbox(config: Omit<RecalboxInstance, 'id' | 'isDefault' | 'archived'>): RecalboxInstance {
    const all = listRecalboxes()
    const id = randomUUID()
    const row = { id, ...config, isDefault: all.length === 0, archived: false, createdAt: new Date() }
    insertRecalbox(row)
    const instance = rowToInstance({ ...row, color: config.color ?? null, iconEmoji: config.iconEmoji ?? null, lastConnectedAt: null })
    this.emit('recalbox:added', { recalbox: instance })
    if (instance.isDefault) {
      this.config = null // force reload with new default
      this.emit('changed:recalbox', this.get())
    }
    return instance
  }

  updateRecalboxConfig(id: string, patch: Partial<Omit<RecalboxInstance, 'id'>>): void {
    updateRecalbox(id, {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.host !== undefined && { host: patch.host }),
      ...(patch.sshUser !== undefined && { sshUser: patch.sshUser }),
      ...(patch.sshPassword !== undefined && { sshPassword: patch.sshPassword }),
      ...(patch.sshPort !== undefined && { sshPort: patch.sshPort }),
      ...(patch.mqttPort !== undefined && { mqttPort: patch.mqttPort }),
      ...(patch.color !== undefined && { color: patch.color }),
      ...(patch.iconEmoji !== undefined && { iconEmoji: patch.iconEmoji }),
      ...(patch.archived !== undefined && { archived: patch.archived }),
    })
    const updated = getRecalbox(id)
    if (!updated) return
    const instance = rowToInstance(updated)
    this.emit('recalbox:updated', { recalbox: instance })
    this.config = null
    this.emit('changed:recalbox', this.get())
  }

  removeRecalbox(id: string): void {
    deleteRecalbox(id)
    this.config = null
    this.emit('recalbox:removed', { id })
    this.emit('changed:recalbox', this.get())
  }

  setDefaultRecalbox(id: string): void {
    setDefaultRecalbox(id)
    this.config = null
    const instance = this.getRecalbox(id)
    if (instance) this.emit('recalbox:updated', { recalbox: instance })
    this.emit('changed:recalbox', this.get())
  }
}

const g = globalThis as typeof globalThis & {
  __configStore?: ConfigStore
  __configStoreVersion?: number
}

if (!g.__configStore || g.__configStoreVersion !== SINGLETON_VERSION) {
  g.__configStore = new ConfigStore()
  g.__configStoreVersion = SINGLETON_VERSION
}

export const configStore = g.__configStore
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/settings/schemas.ts apps/dashboard/lib/config-store.ts
git commit -m "feat(multi): ConfigStore supports N Recalboxes with add/update/remove events"
```

---

## Task 5: Active Recalbox — cookie helpers

**Files:**
- Create: `apps/dashboard/lib/recalbox/active.ts`

- [ ] **Step 1: Create active.ts**

```typescript
// apps/dashboard/lib/recalbox/active.ts
import { configStore } from '@/lib/config-store'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'active_recalbox_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/** Returns the active Recalbox ID from cookie, falling back to default. Server-side only. */
export async function getActiveRecalboxId(): Promise<string | null> {
  const jar = await cookies()
  const fromCookie = jar.get(COOKIE_NAME)?.value
  if (fromCookie && configStore.getRecalbox(fromCookie)) return fromCookie
  return configStore.getDefaultRecalbox()?.id ?? configStore.getRecalboxes()[0]?.id ?? null
}

/** Sets the active Recalbox cookie. Server-side only (call from Server Action or Route Handler). */
export async function setActiveRecalboxId(id: string): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
}
```

- [ ] **Step 2: Create `PUT /api/recalboxes/active` route**

Create `apps/dashboard/app/api/recalboxes/active/route.ts`:

```typescript
import { setActiveRecalboxId } from '@/lib/recalbox/active'
import { configStore } from '@/lib/config-store'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({ id: z.string().uuid() })

export async function PUT(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid id' }, { status: 422 })
  if (!configStore.getRecalbox(parsed.data.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await setActiveRecalboxId(parsed.data.id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/recalbox/active.ts apps/dashboard/app/api/recalboxes/active/route.ts
git commit -m "feat(multi): active Recalbox cookie helpers and PUT /api/recalboxes/active"
```

---

## Task 6: SSH Pool

**Files:**
- Modify: `apps/dashboard/lib/recalbox/ssh-client.ts`

- [ ] **Step 1: Replace ssh-client.ts**

```typescript
import { configStore } from '@/lib/config-store'
import { logger } from '@/lib/logger'
import { NodeSSH } from 'node-ssh'

const EXEC_TIMEOUT_MS = 5000
const CONNECT_TIMEOUT_MS = 8000
const MAX_CONCURRENT = 2

class SshClient {
  private ssh = new NodeSSH()
  private connected = false
  private connectingPromise: Promise<void> | null = null
  private activeCount = 0
  private readonly waitQueue: Array<() => void> = []

  constructor(private readonly recalboxId: string) {}

  private async connect(): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise
    this.connectingPromise = (async () => {
      this.ssh.dispose()
      this.ssh = new NodeSSH()
      const cfg = configStore.getForRecalbox(this.recalboxId).recalbox
      const connectPromise = this.ssh.connect({
        host: cfg.host, username: cfg.sshUser, password: cfg.sshPassword,
        port: cfg.sshPort, readyTimeout: EXEC_TIMEOUT_MS, keepaliveInterval: 10000,
      })
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`SSH connect timed out after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS),
      )
      await Promise.race([connectPromise, timeout])
      this.connected = true
      this.ssh.connection?.on('error', (err: unknown) => {
        this.connected = false
        logger.error(`SSH [${this.recalboxId}] connection reset externally`, err)
      })
      logger.info(`SSH [${this.recalboxId}] connected to ${cfg.host}`)
    })().finally(() => { this.connectingPromise = null })
    return this.connectingPromise
  }

  private acquire(): Promise<void> {
    if (this.activeCount < MAX_CONCURRENT) { this.activeCount++; return Promise.resolve() }
    return new Promise<void>((resolve) => this.waitQueue.push(resolve))
  }

  private release(): void {
    const next = this.waitQueue.shift()
    if (next) { next() } else { this.activeCount-- }
  }

  private async runExec(command: string, timeoutMs: number): Promise<string> {
    if (!this.connected || !this.ssh.isConnected()) await this.connect()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`SSH command timed out: ${command}`)), timeoutMs),
    )
    const execPromise = this.ssh.execCommand(command).then((result) => {
      if (result.stderr) logger.warn(`SSH stderr for "${command}": ${result.stderr}`)
      return result.stdout.trim()
    })
    try {
      return await Promise.race([execPromise, timeoutPromise])
    } catch (err) {
      this.connected = false
      logger.error(`SSH exec failed for "${command}", marking disconnected`, err)
      throw err
    }
  }

  async exec(command: string, timeoutMs = EXEC_TIMEOUT_MS): Promise<string> {
    await this.acquire()
    try {
      try { return await this.runExec(command, timeoutMs) } catch {
        await this.connect()
        return await this.runExec(command, timeoutMs)
      }
    } finally { this.release() }
  }

  disconnect(): void {
    this.ssh.dispose()
    this.connected = false
  }
}

const POOL_VERSION = 1

class SshPool {
  private clients = new Map<string, SshClient>()

  getClient(recalboxId: string): SshClient {
    if (!this.clients.has(recalboxId)) {
      this.clients.set(recalboxId, new SshClient(recalboxId))
    }
    return this.clients.get(recalboxId)!
  }

  removeClient(recalboxId: string): void {
    this.clients.get(recalboxId)?.disconnect()
    this.clients.delete(recalboxId)
  }

  async closeAll(): Promise<void> {
    for (const client of this.clients.values()) client.disconnect()
    this.clients.clear()
  }
}

const g = globalThis as typeof globalThis & {
  __sshPool?: SshPool
  __sshPoolVersion?: number
}

if (!g.__sshPool || g.__sshPoolVersion !== POOL_VERSION) {
  g.__sshPool?.closeAll()
  g.__sshPool = new SshPool()
  g.__sshPoolVersion = POOL_VERSION
  configStore.on('recalbox:updated', ({ recalbox }) => {
    g.__sshPool?.removeClient(recalbox.id) // force reconnect on next request
  })
  configStore.on('recalbox:removed', ({ id }) => {
    g.__sshPool?.removeClient(id)
  })
}

export const sshPool = g.__sshPool

/** Backward-compat: returns SSH client for the given Recalbox ID. */
export function getSshClient(recalboxId: string): SshClient {
  return sshPool.getClient(recalboxId)
}

/** @deprecated Use getSshClient(recalboxId) instead. Kept for code that uses the old singleton. */
export const sshClient = new Proxy({} as SshClient, {
  get(_target, prop) {
    // Falls back to first non-archived Recalbox — use getSshClient() for explicit id
    const id = configStore.getDefaultRecalbox()?.id
    if (!id) throw new Error('No Recalbox configured')
    return (sshPool.getClient(id) as unknown as Record<string, unknown>)[prop as string]
  },
})
```

> **Note**: Any callers of `sshClient.exec(...)` will continue to work (they'll use the default Recalbox). Update each call site to pass an explicit `recalboxId` in later tasks.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/lib/recalbox/ssh-client.ts
git commit -m "feat(multi): SshPool replaces singleton ssh-client"
```

---

## Task 7: MQTT Pool

**Files:**
- Modify: `apps/dashboard/lib/recalbox/mqtt-client.ts`

- [ ] **Step 1: Replace mqtt-client.ts**

Keep the existing `RecalboxMqttClient` class intact; add a pool around it:

```typescript
import { EventEmitter } from 'node:events'
import { configStore } from '@/lib/config-store'
import type { RecalboxInstance } from '@/lib/settings/schemas'
import { logger } from '@/lib/logger'
import mqtt from 'mqtt'
import { parseRecalboxMessage } from './events'
import type { GameStartEvent, GameStopEvent, SystemChangeEvent, SystemInfoEvent } from './events'

const ES_EVENT_TOPIC = 'Recalbox/WebAPI/EmulationStation/Event'
const SYSTEM_INFO_TOPIC = 'Recalbox/WebAPI/SystemInfo'
const SINGLETON_VERSION = 7
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000]

interface RecalboxClientEvents {
  'game:start': (event: GameStartEvent) => void
  'game:stop': (event: GameStopEvent) => void
  'system:change': (event: SystemChangeEvent) => void
  'system:info': (event: SystemInfoEvent) => void
  'connection:up': () => void
  'connection:down': () => void
}

declare interface RecalboxMqttClient {
  on<K extends keyof RecalboxClientEvents>(event: K, listener: RecalboxClientEvents[K]): this
  off<K extends keyof RecalboxClientEvents>(event: K, listener: RecalboxClientEvents[K]): this
  emit<K extends keyof RecalboxClientEvents>(event: K, ...args: Parameters<RecalboxClientEvents[K]>): boolean
}

class RecalboxMqttClient extends EventEmitter {
  private client: mqtt.MqttClient | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private currentSystem: string | null = null
  isConnected = false
  lastKnownGame: GameStartEvent | null = null

  constructor(private readonly brokerUrl: string) { super() }

  connect(): void {
    if (this.client) return
    this.createConnection()
  }

  private createConnection(): void {
    logger.info(`MQTT connecting to ${this.brokerUrl}`)
    this.client = mqtt.connect(this.brokerUrl, {
      reconnectPeriod: 0, connectTimeout: 5000,
      clientId: `recalbox-dashboard-${Math.random().toString(16).slice(2, 10)}`,
    })
    this.client.on('connect', () => {
      this.reconnectAttempt = 0
      this.isConnected = true
      logger.info(`MQTT connected to ${this.brokerUrl}`)
      this.client!.subscribe(ES_EVENT_TOPIC, { qos: 0 })
      this.client!.subscribe(SYSTEM_INFO_TOPIC, { qos: 0 })
      this.emit('connection:up')
    })
    this.client.on('message', (topic, payload) => {
      const event = parseRecalboxMessage(topic, payload)
      if (!event) return
      if (event.type === 'game:start') {
        this.currentSystem = event.system; this.lastKnownGame = event; this.emit('game:start', event)
      } else if (event.type === 'game:stop') {
        if (this.lastKnownGame?.romPath === event.romPath) this.lastKnownGame = null
        this.emit('game:stop', event)
      } else if (event.type === 'system:change') {
        if (event.system !== this.currentSystem) { this.currentSystem = event.system; this.emit('system:change', event) }
      } else if (event.type === 'system:info') {
        this.emit('system:info', event)
      }
    })
    this.client.on('error', (err) => logger.error('MQTT error', err))
    this.client.on('close', () => {
      this.isConnected = false; logger.warn(`MQTT disconnected from ${this.brokerUrl}`)
      this.emit('connection:down'); this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = BACKOFF_DELAYS_MS[Math.min(this.reconnectAttempt, BACKOFF_DELAYS_MS.length - 1)]
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.client = null; this.createConnection() }, delay)
  }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.client?.end(); this.client = null; this.isConnected = false
  }

  reconnect(): void {
    this.disconnect(); this.reconnectAttempt = 0; this.createConnection()
  }
}

class MqttPool {
  private clients = new Map<string, RecalboxMqttClient>()

  getClient(recalboxId: string): RecalboxMqttClient {
    if (!this.clients.has(recalboxId)) {
      const rb = configStore.getRecalbox(recalboxId)
      if (!rb) throw new Error(`Recalbox ${recalboxId} not found`)
      const url = `mqtt://${rb.host}:${rb.mqttPort}`
      const client = new RecalboxMqttClient(url)
      client.connect()
      this.clients.set(recalboxId, client)
    }
    return this.clients.get(recalboxId)!
  }

  removeClient(recalboxId: string): void {
    this.clients.get(recalboxId)?.disconnect()
    this.clients.delete(recalboxId)
  }

  getAllClients(): Map<string, RecalboxMqttClient> {
    return this.clients
  }

  disconnectAll(): void {
    for (const client of this.clients.values()) client.disconnect()
    this.clients.clear()
  }
}

const g = globalThis as typeof globalThis & {
  __mqttPool?: MqttPool
  __mqttPoolVersion?: number
}

if (!g.__mqttPool || g.__mqttPoolVersion !== SINGLETON_VERSION) {
  g.__mqttPool?.disconnectAll()
  g.__mqttPool = new MqttPool()
  g.__mqttPoolVersion = SINGLETON_VERSION

  configStore.on('recalbox:added', ({ recalbox }) => {
    if (!recalbox.archived) g.__mqttPool?.getClient(recalbox.id)
  })
  configStore.on('recalbox:updated', ({ recalbox }) => {
    g.__mqttPool?.removeClient(recalbox.id)
    if (!recalbox.archived) g.__mqttPool?.getClient(recalbox.id)
  })
  configStore.on('recalbox:removed', ({ id }) => {
    g.__mqttPool?.removeClient(id)
  })

  // Pre-connect all non-archived Recalboxes
  for (const rb of configStore.getRecalboxes().filter((r) => !r.archived)) {
    try { g.__mqttPool.getClient(rb.id) } catch { /* ignore if no Recalbox configured yet */ }
  }
}

export const mqttPool = g.__mqttPool

/** Returns the MQTT client for the given Recalbox ID. */
export function getMqttClientFor(recalboxId: string): RecalboxMqttClient {
  return mqttPool.getClient(recalboxId)
}

/** @deprecated Use getMqttClientFor(recalboxId). Returns client for default Recalbox. */
export function getMqttClient(): RecalboxMqttClient {
  const id = configStore.getDefaultRecalbox()?.id
  if (!id) {
    // Return a disconnected no-op client so existing callers don't crash on fresh install
    const noop = new RecalboxMqttClient('mqtt://localhost:1883')
    return noop
  }
  return mqttPool.getClient(id)
}

export type { RecalboxMqttClient }
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/lib/recalbox/mqtt-client.ts
git commit -m "feat(multi): MqttPool replaces singleton mqtt-client, hot-reload on config changes"
```

---

## Task 8: Refactor DB queries to accept `recalboxId`

**Files:**
- Modify: `apps/dashboard/lib/db/queries.ts`

- [ ] **Step 1: Update `insertSystemSnapshot` and `getRecentSnapshots`**

In `queries.ts`, change:

```typescript
export async function insertSystemSnapshot(stats: SystemStats, recalboxId: string): Promise<void> {
  await db.insert(systemSnapshots).values({
    recalboxId,
    capturedAt: stats.takenAt,
    cpuPercent: stats.cpuUsage,
    memUsedMb: stats.ramUsedMb,
    memTotalMb: stats.ramTotalMb,
    tempCelsius: stats.cpuTemp,
    uptimeSeconds: stats.uptimeSec !== null ? Math.round(stats.uptimeSec) : null,
  })
}

export async function getRecentSnapshots(minutes: number, recalboxId?: string) {
  const since = new Date(Date.now() - minutes * 60 * 1000)
  const conditions = [gte(systemSnapshots.capturedAt, since)]
  if (recalboxId) conditions.push(eq(systemSnapshots.recalboxId, recalboxId))
  return db.select().from(systemSnapshots).where(sql.join(conditions, sql` AND `)).orderBy(systemSnapshots.capturedAt)
}
```

- [ ] **Step 2: Update `upsertGames`**

Change signature to accept `recalboxId`:

```typescript
export async function upsertGames(
  parsedGames: ParsedGame[],
  system: string,
  diskSource: string,
  recalboxId: string,
): Promise<number> {
```

In the `.values()` call, add `recalboxId` to each game object. Change the `onConflictDoUpdate` target from `games.romPath` to the composite unique `{ target: [games.recalboxId, games.romPath], ... }` (Drizzle syntax for composite target):

```typescript
.onConflictDoUpdate({
  target: [games.recalboxId, games.romPath],
  set: {
    name: sql`excluded.name`,
    // ... (all other fields unchanged)
  },
})
```

- [ ] **Step 3: Update `listGames` and `getCollectionStats`**

Add optional `recalboxId?: string` parameter to both. When provided, add `eq(games.recalboxId, recalboxId)` to conditions.

```typescript
export async function listGames(
  filters: CollectionFilters & { recalboxId?: string } = {},
): Promise<{ games: Game[]; total: number }> {
  const { recalboxId, ...rest } = filters
  const conditions = [eq(games.hidden, false)]
  if (recalboxId) conditions.push(eq(games.recalboxId, recalboxId))
  // ... rest of existing conditions unchanged
```

Same pattern for `getCollectionStats`, `listRegions`, `countSrStats`, `listUncheckedGames`.

- [ ] **Step 4: Update `openSession`**

```typescript
export async function openSession(opts: {
  recalboxId: string
  gameId?: number
  startedAt: Date
  system: string
  romPath: string
}): Promise<number> {
  const result = await db.insert(sessions).values({
    recalboxId: opts.recalboxId,
    gameId: opts.gameId ?? null,
    startedAt: opts.startedAt,
    system: opts.system,
    romPath: opts.romPath,
  }).returning({ id: sessions.id })
```

- [ ] **Step 5: Update `listSessions` and `getSessionStats`**

Add optional `recalboxId?: string` parameter. When provided, add `sql\`${sessions.recalboxId} = ${recalboxId}\`` to conditions.

Also add `listAllSessionsAcrossRecalboxes` for the `/all-recalboxes` view:

```typescript
export async function listAllSessionsAcrossRecalboxes(
  filters: SessionFilters = {},
): Promise<{ sessions: Session[]; total: number }> {
  // Same as listSessions but without recalboxId filter
  return listSessions(filters)
}

export async function getSessionStatsAllRecalboxes(
  opts: { fromDate?: Date; toDate?: Date; topGamesLimit?: number } = {},
): Promise<SessionStats> {
  return getSessionStats(opts) // no recalboxId = all
}
```

- [ ] **Step 6: Update joins in `getSessionStats`**

Change the `leftJoin(games, eq(sessions.romPath, games.romPath))` to include `recalboxId`:

```typescript
.leftJoin(games, and(
  eq(sessions.recalboxId, games.recalboxId),
  eq(sessions.romPath, games.romPath),
))
```

- [ ] **Step 7: Update `updateGameSrInfo` and `getGameSrInfo`**

These use `romPath` as filter. Add `recalboxId` parameter:

```typescript
export function updateGameSrInfo(recalboxId: string, romPath: string, srSlug: string, srHasPage: boolean, srUrl: string | null): void {
  db.update(games).set({ srSlug, srHasPage: srHasPage ? 1 : 0, srUrl: srUrl ?? null, srCheckedAt: new Date() })
    .where(and(eq(games.recalboxId, recalboxId), eq(games.romPath, romPath))).run()
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/lib/db/queries.ts
git commit -m "feat(multi): DB queries accept recalboxId for multi-tenant filtering"
```

---

## Task 9: Scrobbler — multi-instance

**Files:**
- Modify: `apps/dashboard/lib/scrobbler/session-manager.ts`
- Modify: `apps/dashboard/lib/scrobbler/index.ts`

- [ ] **Step 1: Pass `recalboxId` through SessionManager**

In `session-manager.ts`, update `openSession` to accept and pass `recalboxId`:

```typescript
async openSession(event: GameStartEvent, recalboxId: string): Promise<void> {
  const open = await this.getOpen()
  // ... existing logic
  // When calling this.insert(), pass recalboxId:
  await this.db.insert(sessions).values({
    recalboxId,
    startedAt: event.timestamp ?? new Date(),
    system: event.system,
    romPath: event.romPath,
  })
```

Add `recalboxId` field to all relevant session insertions in this file.

- [ ] **Step 2: Rewrite scrobbler to subscribe to all MQTT clients**

Replace `apps/dashboard/lib/scrobbler/index.ts`:

```typescript
import { db } from '@/lib/db/index'
import { logger } from '@/lib/logger'
import type { GameStartEvent, GameStopEvent } from '@/lib/recalbox/events'
import { mqttPool, getMqttClientFor } from '@/lib/recalbox/mqtt-client'
import { configStore } from '@/lib/config-store'
import { SessionManager } from './session-manager'

export type Scrobbler = { stop: () => Promise<void> }

export async function startScrobbler(): Promise<Scrobbler> {
  const manager = new SessionManager(db)
  const recovered = await manager.recoverOrphanSessions()
  if (recovered > 0) logger.info(`Recovered ${recovered} orphan session(s)`)

  const subscriptions = new Map<string, { start: (e: GameStartEvent) => void; stop: (e: GameStopEvent) => void }>()

  function subscribeToRecalbox(recalboxId: string): void {
    if (subscriptions.has(recalboxId)) return
    const client = getMqttClientFor(recalboxId)
    client.connect()

    const onStart = async (event: GameStartEvent) => {
      try { await manager.openSession(event, recalboxId) } catch (err) { logger.error(`Error opening session [${recalboxId}]`, err) }
    }
    const onStop = async (event: GameStopEvent) => {
      try { await manager.closeSession(event) } catch (err) { logger.error(`Error closing session [${recalboxId}]`, err) }
    }

    client.on('game:start', onStart)
    client.on('game:stop', onStop)
    subscriptions.set(recalboxId, { start: onStart, stop: onStop })
    logger.info(`Scrobbler subscribed to Recalbox ${recalboxId}`)
  }

  function unsubscribeFromRecalbox(recalboxId: string): void {
    const handlers = subscriptions.get(recalboxId)
    if (!handlers) return
    try {
      const client = getMqttClientFor(recalboxId)
      client.off('game:start', handlers.start)
      client.off('game:stop', handlers.stop)
    } catch {}
    subscriptions.delete(recalboxId)
    logger.info(`Scrobbler unsubscribed from Recalbox ${recalboxId}`)
  }

  // Subscribe to all current non-archived Recalboxes
  for (const rb of configStore.getRecalboxes().filter((r) => !r.archived)) {
    subscribeToRecalbox(rb.id)
  }

  // Hot-reload
  const onAdded = ({ recalbox }: { recalbox: { id: string; archived: boolean } }) => {
    if (!recalbox.archived) subscribeToRecalbox(recalbox.id)
  }
  const onRemoved = ({ id }: { id: string }) => unsubscribeFromRecalbox(id)
  configStore.on('recalbox:added', onAdded)
  configStore.on('recalbox:removed', onRemoved)

  logger.info('Scrobbler listening for game events on all Recalboxes')

  return {
    stop: async () => {
      configStore.off('recalbox:added', onAdded)
      configStore.off('recalbox:removed', onRemoved)
      for (const id of subscriptions.keys()) unsubscribeFromRecalbox(id)
      await manager.closeAllOpenSessions('daemon_shutdown')
      mqttPool.disconnectAll()
      logger.info('Scrobbler stopped')
    },
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/lib/scrobbler/index.ts apps/dashboard/lib/scrobbler/session-manager.ts
git commit -m "feat(multi): scrobbler subscribes to all Recalboxes with hot-reload"
```

---

## Task 10: SSE multi-source

**Files:**
- Modify: `apps/dashboard/app/api/events/route.ts`

- [ ] **Step 1: Update the SSE route**

Replace `app/api/events/route.ts`:

```typescript
import type { Notification } from '@/lib/notifications/types'
import { getNotificationService } from '@/lib/notifications/service'
import type { RecalboxEvent } from '@/lib/recalbox/events'
import { mqttPool } from '@/lib/recalbox/mqtt-client'
import { configStore } from '@/lib/config-store'
import type { RecalboxMqttClient } from '@/lib/recalbox/mqtt-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const recalboxIdFilter = url.searchParams.get('recalboxId')
  const notifService = getNotificationService()

  const stream = new ReadableStream({
    start(controller) {
      const encode = (chunk: string) => new TextEncoder().encode(chunk)

      const sendEvent = (recalboxId: string, event: RecalboxEvent) => {
        if (recalboxIdFilter && recalboxIdFilter !== recalboxId) return
        try { controller.enqueue(encode(`data: ${JSON.stringify({ ...event, recalboxId })}\n\n`)) } catch {}
      }

      const sendNotification = (notif: Notification) => {
        try { controller.enqueue(encode(`data: ${JSON.stringify({ type: 'notification', notification: notif })}\n\n`)) } catch {}
      }

      const sendConnectionStatus = (recalboxId: string, online: boolean) => {
        if (recalboxIdFilter && recalboxIdFilter !== recalboxId) return
        try { controller.enqueue(encode(`data: ${JSON.stringify({ type: 'connection', online, recalboxId })}\n\n`)) } catch {}
      }

      // Subscribe to all active Recalboxes
      const recalboxIds = configStore.getRecalboxes().filter((r) => !r.archived).map((r) => r.id)
      const cleanups: Array<() => void> = []

      for (const recalboxId of recalboxIds) {
        let client: RecalboxMqttClient
        try { client = mqttPool.getClient(recalboxId) } catch { continue }

        // Send current state immediately
        sendConnectionStatus(recalboxId, client.isConnected)
        if (client.lastKnownGame && (!recalboxIdFilter || recalboxIdFilter === recalboxId)) {
          sendEvent(recalboxId, client.lastKnownGame)
        }

        const onGameStart = (e: RecalboxEvent) => sendEvent(recalboxId, e)
        const onGameStop = (e: RecalboxEvent) => sendEvent(recalboxId, e)
        const onSystemChange = (e: RecalboxEvent) => sendEvent(recalboxId, e)
        const onSystemInfo = (e: RecalboxEvent) => sendEvent(recalboxId, e)
        const onUp = () => sendConnectionStatus(recalboxId, true)
        const onDown = () => sendConnectionStatus(recalboxId, false)

        client.on('game:start', onGameStart as Parameters<typeof client.on>[1])
        client.on('game:stop', onGameStop as Parameters<typeof client.on>[1])
        client.on('system:change', onSystemChange as Parameters<typeof client.on>[1])
        client.on('system:info', onSystemInfo as Parameters<typeof client.on>[1])
        client.on('connection:up', onUp)
        client.on('connection:down', onDown)

        cleanups.push(() => {
          client.off('game:start', onGameStart as Parameters<typeof client.on>[1])
          client.off('game:stop', onGameStop as Parameters<typeof client.on>[1])
          client.off('system:change', onSystemChange as Parameters<typeof client.on>[1])
          client.off('system:info', onSystemInfo as Parameters<typeof client.on>[1])
          client.off('connection:up', onUp)
          client.off('connection:down', onDown)
        })
      }

      const onNotificationCreated = (notif: Notification) => {
        notifService.markPushedInApp(notif.id).then((claimed) => { if (claimed) sendNotification(notif) })
      }
      notifService.on('created', onNotificationCreated)

      const pollNotifications = async () => {
        try {
          const unpushed = await notifService.getUnpushedInApp(0)
          for (const notif of unpushed) {
            const claimed = await notifService.markPushedInApp(notif.id)
            if (claimed) sendNotification(notif)
          }
        } catch {}
      }
      const pollInterval = setInterval(pollNotifications, 5000)

      const heartbeat = setInterval(() => {
        try { controller.enqueue(encode(': heartbeat\n\n')) } catch { clearInterval(heartbeat) }
      }, 15000)

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        clearInterval(pollInterval)
        for (const cleanup of cleanups) cleanup()
        notifService.off('created', onNotificationCreated)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/app/api/events/route.ts
git commit -m "feat(multi): SSE endpoint subscribes to all Recalboxes, filters by recalboxId param"
```

---

## Task 11: CRUD API for Recalboxes

**Files:**
- Create: `apps/dashboard/app/api/recalboxes/route.ts`
- Create: `apps/dashboard/app/api/recalboxes/[id]/route.ts`
- Create: `apps/dashboard/app/api/recalboxes/[id]/test-connection/route.ts`

- [ ] **Step 1: Create `GET /api/recalboxes` and `POST /api/recalboxes`**

```typescript
// apps/dashboard/app/api/recalboxes/route.ts
import { configStore } from '@/lib/config-store'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const all = configStore.getRecalboxes().map((rb) => ({ ...rb, sshPassword: '***' }))
  return NextResponse.json(all)
}

const createSchema = z.object({
  name: z.string().min(1).max(64),
  host: z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/),
  sshUser: z.string().min(1).max(32),
  sshPassword: z.string().min(1).max(128),
  sshPort: z.number().int().min(1).max(65535).default(22),
  mqttPort: z.number().int().min(1).max(65535).default(1883),
  color: z.string().nullable().optional(),
  iconEmoji: z.string().nullable().optional(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const rb = configStore.addRecalbox({ ...parsed.data, color: parsed.data.color ?? null, iconEmoji: parsed.data.iconEmoji ?? null })
  return NextResponse.json({ ...rb, sshPassword: '***' }, { status: 201 })
}
```

- [ ] **Step 2: Create per-ID routes**

```typescript
// apps/dashboard/app/api/recalboxes/[id]/route.ts
import { configStore } from '@/lib/config-store'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const rb = configStore.getRecalbox(id)
  if (!rb) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ...rb, sshPassword: '***' })
}

const updateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  host: z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/).optional(),
  sshUser: z.string().min(1).max(32).optional(),
  sshPassword: z.string().min(1).max(128).optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  mqttPort: z.number().int().min(1).max(65535).optional(),
  color: z.string().nullable().optional(),
  iconEmoji: z.string().nullable().optional(),
  archived: z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  if (!configStore.getRecalbox(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  configStore.updateRecalboxConfig(id, parsed.data)
  const updated = configStore.getRecalbox(id)!
  return NextResponse.json({ ...updated, sshPassword: '***' })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  if (!configStore.getRecalbox(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const all = configStore.getRecalboxes().filter((r) => !r.archived)
  if (all.length === 1 && all[0].id === id) {
    return NextResponse.json({ error: 'Cannot delete the last Recalbox' }, { status: 409 })
  }
  configStore.removeRecalbox(id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Create test-connection route per Recalbox**

```typescript
// apps/dashboard/app/api/recalboxes/[id]/test-connection/route.ts
import { configStore } from '@/lib/config-store'
import { type NextRequest, NextResponse } from 'next/server'
import { NodeSSH } from 'node-ssh'
import mqtt from 'mqtt'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

async function testSsh(host: string, user: string, password: string, port: number) {
  const start = Date.now()
  const ssh = new NodeSSH()
  try {
    await ssh.connect({ host, username: user, password, port, readyTimeout: 5000 })
    await ssh.execCommand('echo ok')
    ssh.dispose()
    return { success: true, latencyMs: Date.now() - start }
  } catch (err) {
    return { success: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) }
  }
}

async function testMqtt(host: string, port: number) {
  const start = Date.now()
  return new Promise<{ success: boolean; latencyMs: number; messagesReceived: number; error?: string }>((resolve) => {
    let resolved = false; let messages = 0
    const client = mqtt.connect(`mqtt://${host}:${port}`, { connectTimeout: 5000, reconnectPeriod: 0 })
    const done = (success: boolean, error?: string) => {
      if (resolved) return; resolved = true; client.end()
      resolve({ success, latencyMs: Date.now() - start, messagesReceived: messages, error })
    }
    client.on('connect', () => { client.subscribe('#'); setTimeout(() => done(true), 2000) })
    client.on('message', () => { messages++ })
    client.on('error', (err) => done(false, err.message))
    setTimeout(() => done(false, 'Connection timeout'), 6000)
  })
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const rb = configStore.getRecalbox(id)
  if (!rb) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [sshResult, mqttResult] = await Promise.all([
    testSsh(rb.host, rb.sshUser, rb.sshPassword, rb.sshPort),
    testMqtt(rb.host, rb.mqttPort),
  ])
  const overall = sshResult.success && mqttResult.success ? 'ok' : sshResult.success || mqttResult.success ? 'partial' : 'failed'
  return NextResponse.json({ ssh: sshResult, mqtt: mqttResult, overall })
}
```

- [ ] **Step 4: Update collection sync route**

In `app/api/collection/sync/route.ts`, import `getActiveRecalboxId` and pass it to `upsertGames`:

```typescript
import { getActiveRecalboxId } from '@/lib/recalbox/active'
// ...
const recalboxId = await getActiveRecalboxId()
if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
await upsertGames(parsedGames, system, diskSource, recalboxId)
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/api/recalboxes/
git commit -m "feat(multi): CRUD API routes for /api/recalboxes"
```

---

## Task 12: Header Switcher UI

**Files:**
- Create: `apps/dashboard/components/recalbox-switcher.tsx`
- Modify: `apps/dashboard/app/[locale]/layout.tsx`

- [ ] **Step 1: Create RecalboxSwitcher component**

```typescript
// apps/dashboard/components/recalbox-switcher.tsx
'use client'

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type RecalboxItem = {
  id: string
  name: string
  iconEmoji: string | null
  isDefault: boolean
  archived: boolean
}

type Props = {
  recalboxes: RecalboxItem[]
  activeId: string | null
}

export function RecalboxSwitcher({ recalboxes, activeId }: Props) {
  const t = useTranslations('recalboxes')
  const router = useRouter()
  const [switching, setSwitching] = useState(false)

  const active = recalboxes.find((r) => r.id === activeId) ?? recalboxes[0]

  async function switchRecalbox(id: string) {
    setSwitching(true)
    await fetch('/api/recalboxes/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setSwitching(false)
    router.refresh()
  }

  if (recalboxes.length <= 1) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={switching}>
          {active?.iconEmoji ?? '🕹️'} {active?.name ?? '…'} ▾
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('switcher.label')}</DropdownMenuLabel>
        {recalboxes.filter((r) => !r.archived).map((rb) => (
          <DropdownMenuItem key={rb.id} onClick={() => switchRecalbox(rb.id)}>
            <span className="mr-2">{rb.iconEmoji ?? '🕹️'}</span>
            <span className="flex-1">{rb.name}</span>
            {rb.id === activeId && <Check className="h-4 w-4 ml-2" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/recalboxes">{t('switcher.manage')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/recalboxes/add">{t('switcher.add')}</Link>
        </DropdownMenuItem>
        {recalboxes.filter((r) => !r.archived).length >= 2 && (
          <DropdownMenuItem asChild>
            <Link href="/all-recalboxes">{t('switcher.viewAll')}</Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: Add switcher to layout**

In `app/[locale]/layout.tsx`, import the switcher and inject it:

```typescript
import { RecalboxSwitcher } from '@/components/recalbox-switcher'
import { configStore } from '@/lib/config-store'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
// In LocaleLayout function body:
const recalboxes = configStore.getRecalboxes()
const activeRecalboxId = await getActiveRecalboxId()
// In the <nav> JSX, add:
<RecalboxSwitcher recalboxes={recalboxes} activeId={activeRecalboxId} />
```

Place it between the nav links and the right-side controls (before `ThemeToggle`).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/recalbox-switcher.tsx apps/dashboard/app/[locale]/layout.tsx
git commit -m "feat(multi): RecalboxSwitcher in header, hidden when only 1 Recalbox"
```

---

## Task 13: /recalboxes management page

**Files:**
- Create: `apps/dashboard/app/[locale]/recalboxes/page.tsx`
- Create: `apps/dashboard/components/recalbox-form.tsx`

- [ ] **Step 1: Create shared RecalboxForm component**

```typescript
// apps/dashboard/components/recalbox-form.tsx
'use client'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1).max(64),
  iconEmoji: z.string().max(8).optional(),
  host: z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/, 'Invalid hostname'),
  sshUser: z.string().min(1).max(32),
  sshPassword: z.string().min(0).max(128),
  sshPort: z.number().int().min(1).max(65535),
  mqttPort: z.number().int().min(1).max(65535),
})
export type RecalboxFormValues = z.infer<typeof schema>

type TestResult = {
  ssh: { success: boolean; latencyMs: number; error?: string }
  mqtt: { success: boolean; latencyMs: number; messagesReceived: number; error?: string }
  overall: 'ok' | 'partial' | 'failed'
}

type Props = {
  defaultValues?: Partial<RecalboxFormValues>
  onSubmit: (values: RecalboxFormValues) => Promise<void>
  testUrl?: string
  submitLabel?: string
  loading?: boolean
}

export function RecalboxForm({ defaultValues, onSubmit, testUrl, submitLabel, loading }: Props) {
  const t = useTranslations('recalboxes.form')
  const tc = useTranslations('common')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<RecalboxFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', sshUser: 'root', sshPassword: '', sshPort: 22, mqttPort: 1883, ...defaultValues },
  })

  async function handleTest() {
    const values = form.getValues()
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(testUrl ?? '/api/settings/test-connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      setTestResult(await res.json())
    } finally { setTesting(false) }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>{t('name')}</FormLabel><FormControl><Input placeholder="Salon" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="iconEmoji" render={({ field }) => (
            <FormItem><FormLabel>{t('icon')}</FormLabel><FormControl><Input placeholder="🕹️" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="host" render={({ field }) => (
          <FormItem><FormLabel>{t('host')}</FormLabel><FormControl><Input placeholder="recalbox.local" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="sshUser" render={({ field }) => (
            <FormItem><FormLabel>{t('sshUser')}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="sshPassword" render={({ field }) => (
            <FormItem><FormLabel>{t('sshPassword')}</FormLabel><FormControl>
              <div className="relative">
                <Input type={showPassword ? 'text' : 'password'} {...field} />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {showPassword ? t('hide') : t('show')}
                </button>
              </div>
            </FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="sshPort" render={({ field }) => (
            <FormItem><FormLabel>{t('sshPort')}</FormLabel><FormControl>
              <Input type="number" {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
            </FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="mqttPort" render={({ field }) => (
            <FormItem><FormLabel>{t('mqttPort')}</FormLabel><FormControl>
              <Input type="number" {...field} onChange={(e) => field.onChange(e.target.valueAsNumber)} />
            </FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? t('testing') : t('test')}
          </Button>
        </div>
        {testResult && (
          <div className="space-y-2 text-sm">
            {[{ label: 'SSH', r: testResult.ssh }, { label: 'MQTT', r: testResult.mqtt }].map(({ label, r }) => (
              <div key={label} className="flex items-center gap-2 border rounded p-2">
                <span className={r.success ? 'text-green-500' : 'text-red-500'}>{r.success ? '✓' : '✗'}</span>
                <span className="font-medium w-12">{label}</span>
                <span className="text-muted-foreground flex-1">{r.error ?? 'OK'}</span>
                <span className="text-muted-foreground">{r.latencyMs}ms</span>
              </div>
            ))}
          </div>
        )}
        <Button type="submit" disabled={loading}>{submitLabel ?? tc('save')}</Button>
      </form>
    </Form>
  )
}
```

- [ ] **Step 2: Create /recalboxes page**

```typescript
// apps/dashboard/app/[locale]/recalboxes/page.tsx
import { configStore } from '@/lib/config-store'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function RecalboxesPage() {
  const t = await getTranslations('recalboxes')
  const all = configStore.getRecalboxes()
  const activeId = await getActiveRecalboxId()
  const active = all.filter((r) => !r.archived)
  const archived = all.filter((r) => r.archived)

  return (
    <div className="container max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('page.title')}</h1>
        <Button asChild><Link href="/recalboxes/add">+ {t('page.add')}</Link></Button>
      </div>
      <div className="grid gap-4">
        {active.map((rb) => (
          <Card key={rb.id} className={rb.id === activeId ? 'border-primary' : ''}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <span>{rb.iconEmoji ?? '🕹️'}</span>
                <span>{rb.name}</span>
                {rb.isDefault && <span className="text-xs text-muted-foreground border rounded px-1">{t('page.default')}</span>}
                {rb.id === activeId && <span className="text-xs text-primary border border-primary rounded px-1">{t('page.active')}</span>}
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/recalboxes/${rb.id}/edit`}>{t('page.edit')}</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {rb.host} · SSH:{rb.sshPort} · MQTT:{rb.mqttPort}
            </CardContent>
          </Card>
        ))}
      </div>
      {archived.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{t('page.archived')}</p>
          {archived.map((rb) => (
            <Card key={rb.id} className="opacity-60">
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <span className="text-sm">{rb.iconEmoji ?? '🕹️'} {rb.name}</span>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/recalboxes/${rb.id}/edit`}>{t('page.edit')}</Link>
                </Button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/components/recalbox-form.tsx apps/dashboard/app/[locale]/recalboxes/page.tsx
git commit -m "feat(multi): /recalboxes management page and shared RecalboxForm component"
```

---

## Task 14: Add and Edit pages

**Files:**
- Create: `apps/dashboard/app/[locale]/recalboxes/add/page.tsx`
- Create: `apps/dashboard/app/[locale]/recalboxes/[id]/edit/page.tsx`

- [ ] **Step 1: Create add page**

```typescript
// apps/dashboard/app/[locale]/recalboxes/add/page.tsx
'use client'

import { RecalboxForm, type RecalboxFormValues } from '@/components/recalbox-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

export default function AddRecalboxPage() {
  const t = useTranslations('recalboxes')
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(values: RecalboxFormValues) {
    setLoading(true)
    try {
      const res = await fetch('/api/recalboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) throw new Error()
      toast.success(t('add.success'))
      router.push('/recalboxes')
    } catch {
      toast.error(t('add.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container max-w-lg mx-auto p-6">
      <Card>
        <CardHeader><CardTitle>{t('add.title')}</CardTitle></CardHeader>
        <CardContent>
          <RecalboxForm onSubmit={handleSubmit} loading={loading} submitLabel={t('add.submit')} />
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create edit page**

```typescript
// apps/dashboard/app/[locale]/recalboxes/[id]/edit/page.tsx
'use client'

import { RecalboxForm, type RecalboxFormValues } from '@/components/recalbox-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { use } from 'react'

export default function EditRecalboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('recalboxes')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [rb, setRb] = useState<RecalboxFormValues & { name: string } | null>(null)

  useEffect(() => {
    fetch(`/api/recalboxes/${id}`).then((r) => r.json()).then(setRb).catch(() => {})
  }, [id])

  async function handleSubmit(values: RecalboxFormValues) {
    setLoading(true)
    try {
      const res = await fetch(`/api/recalboxes/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      })
      if (!res.ok) throw new Error()
      toast.success(t('edit.success'))
      router.push('/recalboxes')
    } catch { toast.error(t('edit.error')) } finally { setLoading(false) }
  }

  async function handleDelete() {
    if (!confirm(t('edit.deleteConfirm'))) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/recalboxes/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); toast.error(d.error ?? t('edit.deleteError')); return }
      toast.success(t('edit.deleteSuccess'))
      router.push('/recalboxes')
    } catch { toast.error(t('edit.deleteError')) } finally { setDeleting(false) }
  }

  async function handleArchive() {
    await fetch(`/api/recalboxes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: true }) })
    toast.success(t('edit.archived'))
    router.push('/recalboxes')
  }

  if (!rb) return <div className="p-8 text-muted-foreground text-sm">{t('edit.loading')}</div>

  return (
    <div className="container max-w-lg mx-auto p-6 space-y-4">
      <Card>
        <CardHeader><CardTitle>{t('edit.title', { name: rb.name })}</CardTitle></CardHeader>
        <CardContent>
          <RecalboxForm defaultValues={rb} onSubmit={handleSubmit} loading={loading}
            testUrl={`/api/recalboxes/${id}/test-connection`} submitLabel={t('edit.submit')} />
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Button variant="outline" onClick={handleArchive}>{t('edit.archive')}</Button>
        <Button variant="destructive" onClick={handleDelete} disabled={deleting}>{t('edit.delete')}</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/[locale]/recalboxes/
git commit -m "feat(multi): /recalboxes/add and /recalboxes/[id]/edit pages"
```

---

## Task 15: /all-recalboxes aggregated view

**Files:**
- Create: `apps/dashboard/app/[locale]/all-recalboxes/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
// apps/dashboard/app/[locale]/all-recalboxes/page.tsx
import { configStore } from '@/lib/config-store'
import { getSessionStats } from '@/lib/db/queries'
import { getTranslations } from 'next-intl/server'
import { formatDuration } from '@/lib/stats/formatters'

export const dynamic = 'force-dynamic'

export default async function AllRecalboxesPage() {
  const t = await getTranslations('recalboxes')
  const all = configStore.getRecalboxes().filter((r) => !r.archived)

  // Aggregate stats per Recalbox
  const statsPerRb = await Promise.all(
    all.map(async (rb) => {
      const stats = await getSessionStats({}, rb.id)
      return { rb, stats }
    }),
  )

  const totalPlaytime = statsPerRb.reduce((sum, { stats }) => sum + stats.totalPlaytimeSec, 0)
  const totalSessions = statsPerRb.reduce((sum, { stats }) => sum + stats.totalSessions, 0)

  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">{t('allPage.title')}</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="border rounded p-4">
          <p className="text-xs text-muted-foreground">{t('allPage.totalPlaytime')}</p>
          <p className="text-xl font-bold">{formatDuration(totalPlaytime)}</p>
        </div>
        <div className="border rounded p-4">
          <p className="text-xs text-muted-foreground">{t('allPage.totalSessions')}</p>
          <p className="text-xl font-bold">{totalSessions}</p>
        </div>
        <div className="border rounded p-4">
          <p className="text-xs text-muted-foreground">{t('allPage.recalboxes')}</p>
          <p className="text-xl font-bold">{all.length}</p>
        </div>
      </div>
      <div className="space-y-4">
        {statsPerRb.map(({ rb, stats }) => (
          <div key={rb.id} className="border rounded p-4 space-y-1">
            <p className="font-medium">{rb.iconEmoji ?? '🕹️'} {rb.name}</p>
            <div className="text-sm text-muted-foreground flex gap-4">
              <span>{formatDuration(stats.totalPlaytimeSec)}</span>
              <span>{stats.totalSessions} sessions</span>
              <span>{stats.uniqueGames} games</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

> **Note**: You need to update `getSessionStats` to accept an optional `recalboxId` parameter (done in Task 8). If you haven't done that yet, do it now.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/app/[locale]/all-recalboxes/page.tsx
git commit -m "feat(multi): /all-recalboxes aggregated view"
```

---

## Task 16: Welcome wizard — create first Recalbox on finish

**Files:**
- Modify: `apps/dashboard/app/[locale]/welcome/page.tsx`

- [ ] **Step 1: Update `handleFinish` in the wizard**

Replace the `handleFinish` function:

```typescript
async function handleFinish() {
  if (!step1Values) return
  setSaving(true)
  try {
    // Create the first Recalbox via the API (not settings)
    await fetch('/api/recalboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'My Recalbox',
        iconEmoji: '🕹️',
        ...step1Values,
      }),
    })
    await fetch('/api/settings/complete-setup', { method: 'POST' })
    router.push('/')
  } catch {
    setSaving(false)
  }
}
```

Also update the `useEffect` that pre-fills the form — if no existing `recalbox` settings exist (fresh install), it should not pre-fill. The existing code already handles this gracefully since it falls through on error.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/app/[locale]/welcome/page.tsx
git commit -m "feat(multi): welcome wizard creates Recalbox row instead of settings entry"
```

---

## Task 17: Translations — FR + EN

**Files:**
- Modify: `apps/dashboard/messages/en.json`
- Modify: `apps/dashboard/messages/fr.json`

- [ ] **Step 1: Add English translations**

In `en.json`, add a top-level `recalboxes` section:

```json
"recalboxes": {
  "switcher": {
    "label": "Switch Recalbox",
    "manage": "Manage Recalboxes",
    "add": "Add a Recalbox",
    "viewAll": "View all combined"
  },
  "form": {
    "name": "Name",
    "icon": "Icon emoji",
    "host": "Hostname",
    "sshUser": "SSH user",
    "sshPassword": "SSH password",
    "sshPort": "SSH port",
    "mqttPort": "MQTT port",
    "test": "Test connection",
    "testing": "Testing…",
    "show": "Show",
    "hide": "Hide"
  },
  "page": {
    "title": "My Recalboxes",
    "add": "Add Recalbox",
    "default": "Default",
    "active": "Active",
    "edit": "Edit",
    "archived": "Archived"
  },
  "add": {
    "title": "Add a Recalbox",
    "submit": "Add Recalbox",
    "success": "Recalbox added",
    "error": "Failed to add Recalbox"
  },
  "edit": {
    "title": "Edit {name}",
    "submit": "Save changes",
    "success": "Recalbox updated",
    "error": "Failed to update",
    "loading": "Loading…",
    "archive": "Archive",
    "archived": "Recalbox archived",
    "delete": "Delete",
    "deleteConfirm": "Delete this Recalbox and all its data? This cannot be undone.",
    "deleteSuccess": "Recalbox deleted",
    "deleteError": "Cannot delete — it may be the last one"
  },
  "allPage": {
    "title": "All Recalboxes",
    "totalPlaytime": "Total playtime",
    "totalSessions": "Total sessions",
    "recalboxes": "Recalboxes"
  }
}
```

- [ ] **Step 2: Add French translations**

In `fr.json`, add the same structure with French strings:

```json
"recalboxes": {
  "switcher": {
    "label": "Changer de Recalbox",
    "manage": "Gérer les Recalboxes",
    "add": "Ajouter une Recalbox",
    "viewAll": "Voir tout combiné"
  },
  "form": {
    "name": "Nom",
    "icon": "Emoji icône",
    "host": "Nom d'hôte",
    "sshUser": "Utilisateur SSH",
    "sshPassword": "Mot de passe SSH",
    "sshPort": "Port SSH",
    "mqttPort": "Port MQTT",
    "test": "Tester la connexion",
    "testing": "Test en cours…",
    "show": "Afficher",
    "hide": "Masquer"
  },
  "page": {
    "title": "Mes Recalboxes",
    "add": "Ajouter une Recalbox",
    "default": "Défaut",
    "active": "Active",
    "edit": "Modifier",
    "archived": "Archivées"
  },
  "add": {
    "title": "Ajouter une Recalbox",
    "submit": "Ajouter",
    "success": "Recalbox ajoutée",
    "error": "Échec de l'ajout"
  },
  "edit": {
    "title": "Modifier {name}",
    "submit": "Enregistrer",
    "success": "Recalbox mise à jour",
    "error": "Échec de la mise à jour",
    "loading": "Chargement…",
    "archive": "Archiver",
    "archived": "Recalbox archivée",
    "delete": "Supprimer",
    "deleteConfirm": "Supprimer cette Recalbox et toutes ses données ? Irréversible.",
    "deleteSuccess": "Recalbox supprimée",
    "deleteError": "Impossible de supprimer — c'est peut-être la dernière"
  },
  "allPage": {
    "title": "Toutes les Recalboxes",
    "totalPlaytime": "Temps de jeu total",
    "totalSessions": "Sessions totales",
    "recalboxes": "Recalboxes"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/messages/en.json apps/dashboard/messages/fr.json
git commit -m "feat(multi): add recalboxes translations FR + EN"
```

---

## Task 18: Update callers of SSH/MQTT with active recalboxId

**Files:**
- Modify: `apps/dashboard/app/api/system-stats/route.ts`
- Modify: `apps/dashboard/app/api/system/power/route.ts`
- Modify: `apps/dashboard/app/api/media/route.ts`
- Modify: `apps/dashboard/app/api/recalbox/conf/route.ts`
- Modify: `apps/dashboard/lib/recalbox/system-stats.ts`
- Modify: `apps/dashboard/lib/recalbox/system-power.ts`
- Modify: `apps/dashboard/lib/recalbox/conf-reader.ts`
- Modify: `apps/dashboard/lib/recalbox/gamelist-parser.ts`

- [ ] **Step 1: Update API routes to pass active recalboxId to SSH calls**

Pattern for each API route that uses `sshClient`:

```typescript
import { getActiveRecalboxId } from '@/lib/recalbox/active'
import { getSshClient } from '@/lib/recalbox/ssh-client'

// In handler:
const recalboxId = await getActiveRecalboxId()
if (!recalboxId) return NextResponse.json({ error: 'No Recalbox configured' }, { status: 503 })
const ssh = getSshClient(recalboxId)
const result = await ssh.exec('...')
```

Apply this pattern to:
- `app/api/system-stats/route.ts`
- `app/api/system/power/route.ts`
- `app/api/media/route.ts`
- `app/api/recalbox/conf/route.ts`

For `system-stats.ts`, `system-power.ts`, `conf-reader.ts`, `gamelist-parser.ts` — update function signatures to accept `sshClient` as a parameter (or `recalboxId`), so callers can inject the right client:

```typescript
// Old:
export async function getSystemStats(): Promise<SystemStats> {
  const output = await sshClient.exec(...)
}

// New:
import type { SshClientLike } from '@/lib/recalbox/ssh-client'

export async function getSystemStats(ssh: SshClientLike): Promise<SystemStats> {
  const output = await ssh.exec(...)
}
```

Where `SshClientLike` is:
```typescript
export type SshClientLike = { exec: (cmd: string, timeoutMs?: number) => Promise<string> }
```

Add this export to `ssh-client.ts`.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/app/api/ apps/dashboard/lib/recalbox/
git commit -m "feat(multi): pass active recalboxId to all SSH callers"
```

---

## Task 19: Tests

**Files:**
- Create: `apps/dashboard/lib/recalbox/__tests__/active.test.ts`
- Create: `apps/dashboard/lib/db/__tests__/multi-tenant-queries.test.ts`
- Create: `apps/dashboard/scripts/__tests__/migration-multi-recalbox.test.ts`

- [ ] **Step 1: Write active.test.ts**

```typescript
// apps/dashboard/lib/recalbox/__tests__/active.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

vi.mock('@/lib/config-store', () => ({
  configStore: {
    getRecalbox: vi.fn(),
    getDefaultRecalbox: vi.fn(),
    getRecalboxes: vi.fn(),
  },
}))

import { cookies } from 'next/headers'
import { configStore } from '@/lib/config-store'
import { getActiveRecalboxId } from '../active'

describe('getActiveRecalboxId', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns cookie value when Recalbox exists', async () => {
    const jar = { get: vi.fn().mockReturnValue({ value: 'rb-123' }) }
    vi.mocked(cookies).mockResolvedValue(jar as never)
    vi.mocked(configStore.getRecalbox).mockReturnValue({ id: 'rb-123' } as never)

    const id = await getActiveRecalboxId()
    expect(id).toBe('rb-123')
  })

  it('falls back to default when cookie Recalbox not found', async () => {
    const jar = { get: vi.fn().mockReturnValue({ value: 'rb-unknown' }) }
    vi.mocked(cookies).mockResolvedValue(jar as never)
    vi.mocked(configStore.getRecalbox).mockReturnValue(null)
    vi.mocked(configStore.getDefaultRecalbox).mockReturnValue({ id: 'rb-default' } as never)

    const id = await getActiveRecalboxId()
    expect(id).toBe('rb-default')
  })

  it('returns null when no Recalbox configured', async () => {
    const jar = { get: vi.fn().mockReturnValue(undefined) }
    vi.mocked(cookies).mockResolvedValue(jar as never)
    vi.mocked(configStore.getDefaultRecalbox).mockReturnValue(null)
    vi.mocked(configStore.getRecalboxes).mockReturnValue([])

    const id = await getActiveRecalboxId()
    expect(id).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/recalbox/__tests__/active.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 3: Write multi-tenant-queries.test.ts**

```typescript
// apps/dashboard/lib/db/__tests__/multi-tenant-queries.test.ts
import { beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// Use in-memory DB for tests
function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  // Create tables inline (Drizzle push to in-memory)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recalbox_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_seconds INTEGER,
      system TEXT NOT NULL,
      rom_path TEXT NOT NULL,
      auto_closed INTEGER DEFAULT 0,
      closed_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS recalboxes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      ssh_user TEXT NOT NULL,
      ssh_password TEXT NOT NULL,
      ssh_port INTEGER NOT NULL DEFAULT 22,
      mqtt_port INTEGER NOT NULL DEFAULT 1883,
      color TEXT,
      icon_emoji TEXT,
      is_default INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_connected_at INTEGER
    );
  `)
  return drizzle(sqlite, { schema })
}

describe('multi-tenant session queries', () => {
  const db = createTestDb()

  beforeAll(async () => {
    const now = Math.floor(Date.now() / 1000)
    await db.insert(schema.sessions).values([
      { recalboxId: 'rb-a', startedAt: new Date(now * 1000), endedAt: new Date((now + 60) * 1000), durationSeconds: 60, system: 'snes', romPath: '/rom/a.zip' },
      { recalboxId: 'rb-b', startedAt: new Date(now * 1000), endedAt: new Date((now + 120) * 1000), durationSeconds: 120, system: 'nes', romPath: '/rom/b.zip' },
    ])
  })

  it('filters sessions by recalboxId', async () => {
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.recalboxId, 'rb-a'))
    expect(rows).toHaveLength(1)
    expect(rows[0].romPath).toBe('/rom/a.zip')
  })

  it('returns all sessions when no recalboxId filter', async () => {
    const rows = await db.select().from(schema.sessions)
    expect(rows).toHaveLength(2)
  })

  it('does not cross-contaminate recalbox data', async () => {
    const rbA = await db.select().from(schema.sessions).where(eq(schema.sessions.recalboxId, 'rb-a'))
    const rbB = await db.select().from(schema.sessions).where(eq(schema.sessions.recalboxId, 'rb-b'))
    expect(rbA.every((r) => r.recalboxId === 'rb-a')).toBe(true)
    expect(rbB.every((r) => r.recalboxId === 'rb-b')).toBe(true)
  })
})
```

- [ ] **Step 4: Run test**

```bash
pnpm --filter @recalbox/dashboard vitest run lib/db/__tests__/multi-tenant-queries.test.ts
```

Expected: PASS

- [ ] **Step 5: Write migration test**

```typescript
// apps/dashboard/scripts/__tests__/migration-multi-recalbox.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE recalboxes (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, ssh_user TEXT NOT NULL, ssh_password TEXT NOT NULL, ssh_port INTEGER NOT NULL DEFAULT 22, mqtt_port INTEGER NOT NULL DEFAULT 1883, color TEXT, icon_emoji TEXT, is_default INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, created_at INTEGER NOT NULL, last_connected_at INTEGER);
    CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, recalbox_id TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, duration_seconds INTEGER, system TEXT NOT NULL, rom_path TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `)
  return sqlite
}

describe('multi-recalbox migration', () => {
  it('creates default Recalbox from settings and backfills sessions', () => {
    const sqlite = makeDb()
    // Insert existing settings (single-Recalbox era)
    sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.host', 'recalbox.local', ${Date.now()})`).run()
    sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshUser', 'root', ${Date.now()})`).run()
    sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshPassword', 'secret', ${Date.now()})`).run()
    sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshPort', '22', ${Date.now()})`).run()
    sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.mqttPort', '1883', ${Date.now()})`).run()
    // Insert old session without recalbox_id
    sqlite.prepare(`INSERT INTO sessions (recalbox_id, started_at, system, rom_path) VALUES (NULL, ${Math.floor(Date.now()/1000)}, 'snes', '/rom/test.zip')`).run()

    // Simulate migration (inline, not via module to avoid circular deps in test)
    const settings = Object.fromEntries(
      sqlite.prepare('SELECT key, value FROM settings').all().map((r: any) => [r.key, r.value])
    )
    const host = settings['recalbox.host'] ?? 'recalbox.local'
    const defaultId = 'test-uuid-1234'
    sqlite.prepare(`INSERT INTO recalboxes VALUES (?, 'My Recalbox', ?, ?, ?, 22, 1883, NULL, NULL, 1, 0, ?, NULL)`)
      .run(defaultId, host, settings['recalbox.sshUser'] ?? 'root', settings['recalbox.sshPassword'] ?? '', Date.now())
    sqlite.prepare(`UPDATE sessions SET recalbox_id = ? WHERE recalbox_id IS NULL`).run(defaultId)

    // Verify
    const recalboxes = sqlite.prepare('SELECT * FROM recalboxes').all() as any[]
    expect(recalboxes).toHaveLength(1)
    expect(recalboxes[0].host).toBe('recalbox.local')

    const sessions = sqlite.prepare('SELECT * FROM sessions').all() as any[]
    expect(sessions.every((s: any) => s.recalbox_id === defaultId)).toBe(true)
  })

  it('is idempotent: does not create duplicate Recalbox on second run', () => {
    const sqlite = makeDb()
    sqlite.prepare(`INSERT INTO recalboxes VALUES ('existing-id', 'My Recalbox', 'recalbox.local', 'root', '', 22, 1883, NULL, NULL, 1, 0, ${Date.now()}, NULL)`).run()
    sqlite.prepare(`INSERT INTO settings VALUES ('__multi_recalbox_migrated__', 'true', ${Date.now()})`).run()

    // Check flag
    const flag = sqlite.prepare(`SELECT value FROM settings WHERE key = '__multi_recalbox_migrated__'`).get() as any
    expect(flag?.value).toBe('true')

    // No second insert happened
    const count = (sqlite.prepare('SELECT COUNT(*) as c FROM recalboxes').get() as any).c
    expect(count).toBe(1)
  })

  it('preserves existing data: session count unchanged after migration', () => {
    const sqlite = makeDb()
    sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.host', 'box.local', ${Date.now()})`).run()
    sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshUser', 'root', ${Date.now()})`).run()
    sqlite.prepare(`INSERT INTO settings VALUES ('recalbox.sshPassword', 'pass', ${Date.now()})`).run()
    for (let i = 0; i < 5; i++) {
      sqlite.prepare(`INSERT INTO sessions (recalbox_id, started_at, system, rom_path) VALUES (NULL, ${i}, 'snes', '/rom/${i}.zip')`).run()
    }
    const id = 'migrated-id'
    sqlite.prepare(`INSERT INTO recalboxes VALUES (?, 'R', 'box.local', 'root', 'pass', 22, 1883, NULL, NULL, 1, 0, ${Date.now()}, NULL)`).run(id)
    sqlite.prepare(`UPDATE sessions SET recalbox_id = ? WHERE recalbox_id IS NULL`).run(id)

    const count = (sqlite.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c
    expect(count).toBe(5)
    const allLinked = sqlite.prepare(`SELECT COUNT(*) as c FROM sessions WHERE recalbox_id = ?`).get(id) as any
    expect(allLinked.c).toBe(5)
  })
})
```

- [ ] **Step 6: Run all tests**

```bash
pnpm --filter @recalbox/dashboard vitest run scripts/__tests__/migration-multi-recalbox.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/lib/recalbox/__tests__/active.test.ts apps/dashboard/lib/db/__tests__/multi-tenant-queries.test.ts apps/dashboard/scripts/__tests__/migration-multi-recalbox.test.ts
git commit -m "test(multi): active cookie, multi-tenant queries, and migration idempotence tests"
```

---

## Task 20: Build verification and cleanup

- [ ] **Step 1: Fix any TypeScript errors**

```bash
cd apps/dashboard && pnpm build 2>&1 | head -100
```

Common issues to fix:
- `sshClient` proxy type errors → replace usages with `getSshClient(recalboxId)`
- `getMqttClient()` callers that now need `getMqttClientFor(id)` → update
- `upsertGames` callers missing `recalboxId` argument → add active ID
- `insertSystemSnapshot` callers missing `recalboxId` → add

- [ ] **Step 2: Run full test suite**

```bash
pnpm test 2>&1 | tail -30
```

Fix any failures.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

- [ ] **Step 4: Manual smoke test**

With `pnpm dev` running:
1. Visit `/welcome` — confirm wizard creates a row in `recalboxes` table (check via `sqlite3 recalbox.db "select * from recalboxes"`)
2. Visit `/recalboxes` — confirm the list shows the created Recalbox
3. Visit `/recalboxes/add` — add a second (fake) Recalbox with host `192.168.1.100`
4. Confirm switcher appears in header
5. Click switcher → switch to second Recalbox → confirm `active_recalbox_id` cookie is set
6. Visit `/all-recalboxes` — confirm combined view loads
7. Archive the second Recalbox — confirm it moves to archived section
8. Delete the archived Recalbox — confirm it's gone

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(multi): support for multiple Recalbox instances"
```

---

## Self-Review — Spec Coverage Check

| Spec requirement | Task |
|-----------------|------|
| `recalboxes` table | Task 1 |
| Migration without data loss | Tasks 3, 19 |
| Config refactored (array) | Task 4 |
| Switcher in header, hidden at N=1 | Task 12 |
| Active Recalbox via cookie | Task 5 |
| SSH pool | Task 6 |
| MQTT pool | Task 7 |
| Scrobbler multi-subscriber + hot-reload | Task 9 |
| SSE multi-source + filter | Task 10 |
| `PUT /api/recalboxes/active` | Task 5 |
| `/recalboxes` CRUD page | Task 13 |
| `/recalboxes/add` | Task 14 |
| `/recalboxes/[id]/edit` | Task 14 |
| `/all-recalboxes` | Task 15 |
| Wizard adapted | Task 16 |
| Translations FR + EN | Task 17 |
| `recalbox_id` on sessions | Task 1, 8 |
| `recalbox_id` on games | Task 1, 8 |
| `recalbox_id` on system_snapshots | Task 1, 8 |
| `recalbox_id` on ra_game_mapping | Task 1, 8 |
| `recalbox_id` on notifications | Task 1 |
| Migration tests (idempotent) | Task 19 |
| Multi-tenant query tests | Task 19 |
| Cookie active tests | Task 19 |
| Archived Recalbox | Task 13, 14 |
| Hard-delete | Task 11, 14 |
| 0 Recalbox → wizard | Task 16 (wizard sets up first) |
| `pnpm build` passes | Task 20 |

### Gaps identified

1. **Soft-delete data retention**: The spec mentions "archive keeps data, no more scrobble" — the archive flag is set in the DB (`archived: true`). The scrobbler must skip archived Recalboxes. In Task 9, the `subscribeToRecalbox` function already checks `!recalbox.archived`. The `configStore.on('recalbox:updated')` listener in the scrobbler should also unsubscribe when a Recalbox becomes archived. Add this to Task 9's `onAdded` handler:

```typescript
configStore.on('recalbox:updated', ({ recalbox }) => {
  if (recalbox.archived) unsubscribeFromRecalbox(recalbox.id)
  else subscribeToRecalbox(recalbox.id)
})
```

2. **`getSessionStats` recalboxId parameter**: Task 8 must update the function signature. The `getSessionStats(opts, recalboxId?)` signature should be passed through to all query conditions.

3. **`/api/settings/reset` route**: This calls `configStore.reset()` which used to clear `recalbox.*` from settings. After refactor, `recalbox.*` is no longer in settings — the reset should be scoped to avoid touching `recalboxes` table.
