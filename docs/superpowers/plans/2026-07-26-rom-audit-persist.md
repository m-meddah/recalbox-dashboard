# Audit ROM — lot 2B : persistance, transports, API et UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rendre l'audit ROM utilisable depuis le dashboard — déclencher un scan (SSH ou agent), en persister le résultat sans gonfler Turso, et l'afficher système par système avec la liste des jeux manquants.

**Architecture:** trois tables (`rom_scans`, `rom_system_audits`, `rom_files`) alimentées par un noyau de persistance commun aux deux transports. Le détail fichier par fichier reste local ; le cloud ne reçoit que les agrégats par système et les fichiers `unknown`. La liste des manquants n'est jamais stockée : elle se recalcule à l'affichage à partir du DAT en cache et de la liste des entrées matchées, portée par une seule ligne d'agrégat.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (SQLite / Turso), Zod, Vitest, Python 3 stdlib (agent), better-sqlite3 en test.

## Note de méthode

Ce plan reconduit la méthode du lot 2A, pour la même raison : sur les onze extraits d'implémentation pré-écrits des lots 1 et 2A, huit étaient fautifs, et le pire — l'offset RVZ — était recopié à l'identique dans le code et dans sa fixture, donc invisible à toute boucle de test.

Donc, dans ce plan :

- **le code de test est autoritatif** — il définit le contrat, on ne le paraphrase pas ;
- **l'implémentation est spécifiée, pas transcrite** — signatures exactes, invariants, pièges connus, mais l'implémenteur écrit le corps et le fait passer sous les tests.

Un extrait d'implémentation n'apparaît que là où la forme exacte est le contrat (colonnes Drizzle, schéma Zod).

Deux niveaux de test, assumés. Les tâches 1 à 3 portent la logique où l'erreur est silencieuse — écriture incrémentale, découpage, politique de persistance : leurs tests sont écrits **en entier**, corps compris. Les tâches 4 à 8 sont du câblage dont l'erreur est bruyante (une route qui ne répond pas, un bouton qui ne tourne pas) : elles donnent les **noms et l'intention** de chaque test, à charge de l'implémenteur d'en écrire le corps. Un test manquant de cette liste est un manquement au contrat, pas une liberté.

## Périmètre

**Dans le lot :** persistance, transports SSH et agent, découpage des scans multi-systèmes, routes API de lecture et d'export, page d'audit.

**Hors lot, reporté à un lot 2C :**

- le **deep verify** (`chdman` / `dolphin-tool` sur l'hôte dashboard) — sous-système indépendant, binaires externes, self-hosted uniquement ;
- le **parser DAT en streaming** et, avec lui, le branchement des systèmes **MAME** — le parser actuel charge le fichier d'un bloc, ce qui interdit les DAT arcade ;
- l'import et la réparation de collection, déjà hors périmètre du spec.

Le lot reste **strictement en lecture** : rien n'est téléchargé, rien n'est écrit sur la Recalbox.

## Global Constraints

- Biome : **tabulations**, guillemets simples, **pas de point-virgule**, virgules finales. Commentaires de code en anglais.
- Tests dans un sous-dossier `__tests__/` à côté du code testé. Vitest côté TS, `python3 -m unittest` côté agent.
- L'alias `@` pointe sur `apps/dashboard/`.
- **Aucune écriture sur la Recalbox.** Le script de scan voyage sur le **stdin** de l'exec ; la ligne de commande reste sous **8000 octets** (limite mesurée : l'exec SSH échoue entre 8 et 16 Ko, 32 Ko coupe la connexion).
- **Les DAT ne vont jamais en base.** Ils restent en cache fichier / object storage via `lib/rom-audit/catalog.ts`.
- **Aucun appel à ScreenScraper `jeuInfos`** (aucun quota consommé).
- **Frugalité Turso.** Un rescan sans changement doit produire **zéro écriture**. En mode serverless, `rom_files` ne reçoit que les entrées `unknown` ; jamais le détail complet.
- Toute donnée franchissant une frontière de confiance (sortie du scan, corps HTTP de l'agent) passe par Zod avant d'atteindre la base.
- Autorisation : lecture derrière `canViewRecalbox`, déclenchement derrière `canControlRecalbox`.
- Commits conventionnels : `feat(rom-audit): …`, `fix(rom-audit): …`.

## Décisions de conception propres à ce lot

Trois écarts au spec, assumés et justifiés. Ils sont reportés dans le spec en amendement (tâche 1, étape finale).

**1. Une troisième table, `rom_system_audits`.** Le spec en prévoit deux. Mais la règle « détail local, agrégats dans le cloud » rend la liste des jeux manquants incalculable en serverless : sans les fichiers matchés, on ne peut pas soustraire le possédé du catalogue. La table d'agrégat porte donc, en plus des compteurs, `matched_entries` — le tableau JSON des noms d'entrées DAT matchées. Une ligne par (recalbox, système), quelques dizaines de Ko, contre des dizaines de milliers de lignes. Bénéfice secondaire en self-hosted : l'affichage d'un système lit **une** ligne au lieu de plusieurs centaines.

**2. La progression du scan ne passe pas par le SSE.** Le spec l'y plaçait. `app/api/events/route.ts` porte un réglage explicite de ses intervalles de polling parce que chaque onglet ouvert coûte des lectures Turso en permanence ; y ajouter une source ferait payer ce coût à tous les onglets, pour tous les utilisateurs, en dehors de tout scan. La page d'audit interroge `GET /api/rom-audit/scan` toutes les 3 s **uniquement pendant qu'un scan tourne**.

**3. La clé de `rom_files` est `(recalbox_id, entry_key)`, pas `(recalbox_id, path)`.** Une archive 7z contenant vingt ROMs produit vingt entrées de manifeste partageant le même `path`. Une clé sur le chemin seul en écraserait dix-neuf. `entry_key` vaut `path` quand `inner_name` est absent, et `path + '#' + inner_name` sinon.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `lib/db/schema.ts` *(modifié)* | Trois tables : `romScans`, `romSystemAudits`, `romFiles` |
| `drizzle/migrations/00XX_*.sql` *(généré)* | Migration correspondante |
| `lib/db/rom-audit-queries.ts` | Accès base : synchronisation incrémentale, agrégats, cycle de vie d'un scan |
| `lib/rom-audit/scan-batches.ts` | Découpe les cibles en lots tenant sous la limite de commande |
| `lib/rom-audit/scan-runner.ts` *(modifié)* | `runScanBatched` : exécute lot par lot, rend la main à chaque lot |
| `lib/rom-audit/persist.ts` | Politique détail/agrégats, `AuditResult` → lignes de base |
| `lib/rom-audit/discover.ts` | Découverte des supports et des cibles (extrait du CLI, partagé) |
| `lib/rom-audit/run-audit.ts` | Orchestrateur self-hosted : lots → audit → persistance → progression |
| `lib/rom-audit/report.ts` | Agrégats + DAT → vues d'affichage et export CSV |
| `lib/rom-audit/match.ts` *(modifié)* | Extrait `groupCanonicalGames` / `markOwned`, réutilisés par `report.ts` |
| `lib/rom-audit/manifest.ts` *(modifié)* | `parseManifestLenient` pour la frontière HTTP |
| `lib/agent/commands.ts` *(modifié)* | Type de commande `scan` dans l'allowlist |
| `app/api/rom-audit/scan/route.ts` | POST déclenche, GET renvoie l'état |
| `app/api/rom-audit/systems/route.ts` | Vue d'ensemble |
| `app/api/rom-audit/systems/[system]/route.ts` | Détail : manquants / possédés / inconnus |
| `app/api/rom-audit/export/route.ts` | Export CSV ou JSON des manquants |
| `app/api/agent/rom-scan/route.ts` | Ingestion chunkée du manifeste poussé par l'agent |
| `agent/agent.py` *(modifié)* | Exécution locale du scan et push chunké |
| `app/[locale]/collection/audit/page.tsx` | Page d'audit |
| `components/rom-audit/*` | Vue d'ensemble, détail, bouton de scan |
| `scripts/rom-audit.ts` *(modifié)* | Consomme `discover.ts` au lieu de sa copie locale |

---

## Task 1: Tables, migration et accès base incrémental

**Files:**
- Modify: `apps/dashboard/lib/db/schema.ts` (ajout en fin de fichier)
- Create: `apps/dashboard/lib/db/rom-audit-queries.ts`
- Create: `apps/dashboard/lib/db/__tests__/rom-audit-queries.test.ts`
- Generate: `apps/dashboard/drizzle/migrations/00XX_*.sql`
- Modify: `docs/superpowers/specs/2026-07-25-rom-audit-design.md` (amendement)

**Interfaces:**
- Consumes: `DB` depuis `@/lib/db`, `MatchLevel` depuis `@/lib/rom-audit/match`
- Produces:

```ts
// $inferSelect, NOT $inferInsert: the select type makes every optional column
// `T | null`, so a producer that leaves one `undefined` fails to typecheck.
// Drizzle writes `undefined` as "column absent", which on an update silently
// keeps the previous value — the type is the guard against that.
export type RomFileRow = typeof romFiles.$inferSelect
export type RomSystemAuditRow = typeof romSystemAudits.$inferSelect
export type RomScanRow = typeof romScans.$inferSelect
export type SyncResult = { inserted: number; updated: number; deleted: number }

export function entryKey(path: string, innerName?: string | null): string

export async function syncSystemRomFiles(db: DB, recalboxId: string, system: string, rows: readonly RomFileRow[]): Promise<SyncResult>
export async function upsertSystemAudit(db: DB, row: RomSystemAuditRow): Promise<boolean>
export async function getSystemAudit(db: DB, recalboxId: string, system: string): Promise<RomSystemAuditRow | null>
export async function listSystemAudits(db: DB, recalboxId: string): Promise<RomSystemAuditRow[]>
export async function listRomFiles(db: DB, recalboxId: string, system: string, opts?: { matchLevel?: MatchLevel; limit?: number; offset?: number }): Promise<RomFileRow[]>

export async function createScan(db: DB, recalboxId: string, transport: 'ssh' | 'agent', systemsTotal: number, createdBy?: string | null): Promise<RomScanRow>
export async function updateScanProgress(db: DB, id: string, patch: { systemsDone?: number; systemsTotal?: number; currentSystem?: string | null }): Promise<void>
export async function finishScan(db: DB, id: string, status: 'done' | 'failed', error?: string | null): Promise<void>
export async function getScan(db: DB, id: string): Promise<RomScanRow | null>
export async function getLatestScan(db: DB, recalboxId: string): Promise<RomScanRow | null>
export const SCAN_STALE_MS: number
export function isScanStale(row: Pick<RomScanRow, 'status' | 'updatedAt'>, now?: number): boolean
```

- [ ] **Step 1: Écrire les trois tables**

Forme exacte (le reste du fichier donne le style : `sqliteTable`, `int(..., { mode: 'timestamp' })`, index nommés `idx_*`).

```ts
/**
 * One ROM audit run. A run is per Recalbox and covers one or more systems; the
 * progress columns are what the audit page polls while it is in flight.
 */
export const romScans = sqliteTable(
	'rom_scans',
	{
		id: text('id').primaryKey(),
		recalboxId: text('recalbox_id').notNull(),
		// 'pending' (queued for the agent) → 'running' → 'done' | 'failed'.
		status: text('status').notNull().default('pending'),
		// 'ssh' (self-hosted, server-driven) | 'agent' (serverless, box-driven).
		transport: text('transport').notNull(),
		startedAt: int('started_at', { mode: 'timestamp' }).notNull(),
		// Bumped on every progress write: staleness is judged on this, not startedAt.
		updatedAt: int('updated_at', { mode: 'timestamp' }).notNull(),
		completedAt: int('completed_at', { mode: 'timestamp' }),
		systemsTotal: int('systems_total').notNull().default(0),
		systemsDone: int('systems_done').notNull().default(0),
		currentSystem: text('current_system'),
		error: text('error'),
		createdBy: text('created_by'),
	},
	(t) => [index('idx_rom_scans_recalbox_started').on(t.recalboxId, t.startedAt)],
)

/**
 * Per-system audit aggregate — one row per (Recalbox, system). This is the only
 * table the serverless deploy grows per scan, and it is what the overview and
 * the missing-games list read: `matchedEntries` holds the DAT entry names the
 * collection covers, so the missing list is a set difference against the cached
 * DAT, with no per-file read and nothing extra stored.
 */
export const romSystemAudits = sqliteTable(
	'rom_system_audits',
	{
		recalboxId: text('recalbox_id').notNull(),
		system: text('system').notNull(),
		datName: text('dat_name'),
		datVersion: text('dat_version'),
		totalRomEntries: int('total_rom_entries').notNull().default(0),
		matchedRomEntries: int('matched_rom_entries').notNull().default(0),
		verifiedCount: int('verified_count').notNull().default(0),
		serialCount: int('serial_count').notNull().default(0),
		namedCount: int('named_count').notNull().default(0),
		unknownCount: int('unknown_count').notNull().default(0),
		filesScanned: int('files_scanned').notNull().default(0),
		totalBytes: int('total_bytes').notNull().default(0),
		mounts: text('mounts', { mode: 'json' }).$type<string[]>(),
		matchedEntries: text('matched_entries', { mode: 'json' }).$type<string[]>(),
		scannedAt: int('scanned_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [primaryKey({ columns: [t.recalboxId, t.system] })],
)

/**
 * Per-file scan detail. Self-hosted stores every entry; serverless stores only
 * the `unknown` ones (see lib/rom-audit/persist.ts) — the aggregate above
 * carries everything the UI needs for the rest.
 *
 * Keyed on `entryKey`, NOT on `path`: one 7z archive yields one manifest entry
 * per contained ROM, all sharing the same path.
 */
export const romFiles = sqliteTable(
	'rom_files',
	{
		recalboxId: text('recalbox_id').notNull(),
		// `path`, or `path#innerName` when the entry is inside an archive.
		entryKey: text('entry_key').notNull(),
		system: text('system').notNull(),
		mount: text('mount').notNull(),
		path: text('path').notNull(),
		innerName: text('inner_name'),
		size: int('size').notNull(),
		mtime: int('mtime').notNull(),
		kind: text('kind').notNull(),
		crc32: text('crc32'),
		sha1: text('sha1'),
		serial: text('serial'),
		matchLevel: text('match_level').notNull(),
		datEntryName: text('dat_entry_name'),
		canonicalTitle: text('canonical_title'),
		scannedAt: int('scanned_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.recalboxId, t.entryKey] }),
		index('idx_rom_files_recalbox_system').on(t.recalboxId, t.system),
		index('idx_rom_files_recalbox_crc').on(t.recalboxId, t.crc32),
	],
)
```

- [ ] **Step 2: Générer la migration**

```bash
cd apps/dashboard && pnpm exec drizzle-kit generate
```

Attendu : un nouveau `drizzle/migrations/00XX_*.sql` créant les trois tables et leurs index. Vérifier qu'il ne contient **aucun** `DROP` sur une table existante — si c'est le cas, la migration a dérivé et il faut la reprendre, pas la jouer.

- [ ] **Step 3: Écrire les tests (autoritatifs)**

`apps/dashboard/lib/db/__tests__/rom-audit-queries.test.ts` :

```ts
import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	SCAN_STALE_MS,
	createScan,
	entryKey,
	finishScan,
	getLatestScan,
	getScan,
	getSystemAudit,
	isScanStale,
	listRomFiles,
	listSystemAudits,
	syncSystemRomFiles,
	updateScanProgress,
	upsertSystemAudit,
} from '../rom-audit-queries'
import type { RomFileRow, RomSystemAuditRow } from '../rom-audit-queries'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

let sqlite: Database.Database

function makeDb(): DB {
	sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

/** SQLite's own write counter — the only honest way to assert "wrote nothing". */
function writes(): number {
	return (sqlite.prepare('SELECT total_changes() AS c').get() as { c: number }).c
}

const SCANNED_AT = new Date('2026-07-26T10:00:00Z')

function file(over: Partial<RomFileRow> = {}): RomFileRow {
	const path = over.path ?? '/recalbox/share/roms/snes/Game.zip'
	const innerName = over.innerName ?? 'Game (Europe).sfc'
	return {
		recalboxId: 'rb1',
		entryKey: entryKey(path, innerName),
		system: 'snes',
		mount: '/recalbox/share',
		path,
		innerName,
		size: 1048576,
		mtime: 1721900000,
		kind: 'zip-entry',
		crc32: 'e95a3dd7',
		sha1: null,
		serial: null,
		matchLevel: 'verified',
		datEntryName: 'Game (Europe).sfc',
		canonicalTitle: 'Game',
		scannedAt: SCANNED_AT,
		...over,
	}
}

function audit(over: Partial<RomSystemAuditRow> = {}): RomSystemAuditRow {
	return {
		recalboxId: 'rb1',
		system: 'snes',
		datName: 'Nintendo - Super Nintendo Entertainment System',
		datVersion: '2026.05.02',
		totalRomEntries: 4000,
		matchedRomEntries: 1200,
		verifiedCount: 1150,
		serialCount: 0,
		namedCount: 50,
		unknownCount: 7,
		filesScanned: 1207,
		totalBytes: 12345678,
		mounts: ['/recalbox/share'],
		matchedEntries: ['Game (Europe).sfc'],
		scannedAt: SCANNED_AT,
		...over,
	}
}

describe('entryKey', () => {
	it('is the path alone for a bare file', () => {
		expect(entryKey('/roms/snes/Game.sfc', null)).toBe('/roms/snes/Game.sfc')
	})

	// One 7z can hold twenty ROMs; keying on the path alone would keep one.
	it('separates two entries of the same archive', () => {
		const a = entryKey('/roms/nes/Set.7z', 'A.nes')
		const b = entryKey('/roms/nes/Set.7z', 'B.nes')
		expect(a).not.toBe(b)
	})
})

describe('syncSystemRomFiles', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('inserts the rows of a first scan', async () => {
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', [file(), file({ path: '/b.zip' })])
		expect(res).toEqual({ inserted: 2, updated: 0, deleted: 0 })
		expect(await listRomFiles(db, 'rb1', 'snes')).toHaveLength(2)
	})

	// The whole point of the incremental write: a rescan that changes nothing
	// must not rewrite 75k identical rows into Turso.
	it('writes nothing at all when the scan is unchanged', async () => {
		const rows = [file(), file({ path: '/b.zip' })]
		await syncSystemRomFiles(db, 'rb1', 'snes', rows)
		const before = writes()
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', rows)
		expect(res).toEqual({ inserted: 0, updated: 0, deleted: 0 })
		expect(writes()).toBe(before)
	})

	// A re-scan carries a new scannedAt for every row; that alone is not a change.
	it('ignores a change of scannedAt only', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [file()])
		const before = writes()
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', [
			file({ scannedAt: new Date('2026-08-01T00:00:00Z') }),
		])
		expect(res).toEqual({ inserted: 0, updated: 0, deleted: 0 })
		expect(writes()).toBe(before)
	})

	it('updates only the row whose content changed', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [file(), file({ path: '/b.zip' })])
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', [
			file({ mtime: 1721999999 }),
			file({ path: '/b.zip' }),
		])
		expect(res).toEqual({ inserted: 0, updated: 1, deleted: 0 })
		const rows = await listRomFiles(db, 'rb1', 'snes')
		expect(rows.find((r) => r.path === '/recalbox/share/roms/snes/Game.zip')?.mtime).toBe(1721999999)
	})

	it('deletes a row whose file disappeared', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [file(), file({ path: '/b.zip' })])
		const res = await syncSystemRomFiles(db, 'rb1', 'snes', [file()])
		expect(res).toEqual({ inserted: 0, updated: 0, deleted: 1 })
		expect(await listRomFiles(db, 'rb1', 'snes')).toHaveLength(1)
	})

	// A scan of one system must never touch another system's rows, and never
	// another Recalbox's — this is the multi-box safety net.
	it('is scoped to one system and one Recalbox', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [file()])
		await syncSystemRomFiles(db, 'rb1', 'nes', [file({ system: 'nes', path: '/n.zip' })])
		await syncSystemRomFiles(db, 'rb2', 'snes', [file({ recalboxId: 'rb2' })])

		await syncSystemRomFiles(db, 'rb1', 'snes', [])

		expect(await listRomFiles(db, 'rb1', 'snes')).toHaveLength(0)
		expect(await listRomFiles(db, 'rb1', 'nes')).toHaveLength(1)
		expect(await listRomFiles(db, 'rb2', 'snes')).toHaveLength(1)
	})

	it('filters by match level', async () => {
		await syncSystemRomFiles(db, 'rb1', 'snes', [
			file(),
			file({ path: '/u.zip', matchLevel: 'unknown', datEntryName: null }),
		])
		const unknown = await listRomFiles(db, 'rb1', 'snes', { matchLevel: 'unknown' })
		expect(unknown).toHaveLength(1)
		expect(unknown[0]?.path).toBe('/u.zip')
	})
})

describe('upsertSystemAudit', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('writes the aggregate and reads it back', async () => {
		expect(await upsertSystemAudit(db, audit())).toBe(true)
		const row = await getSystemAudit(db, 'rb1', 'snes')
		expect(row?.matchedRomEntries).toBe(1200)
		expect(row?.matchedEntries).toEqual(['Game (Europe).sfc'])
		expect(row?.mounts).toEqual(['/recalbox/share'])
	})

	it('writes nothing when the aggregate is unchanged', async () => {
		await upsertSystemAudit(db, audit())
		const before = writes()
		expect(await upsertSystemAudit(db, audit({ scannedAt: new Date('2026-08-01T00:00:00Z') }))).toBe(
			false,
		)
		expect(writes()).toBe(before)
	})

	it('rewrites when a counter changed', async () => {
		await upsertSystemAudit(db, audit())
		expect(await upsertSystemAudit(db, audit({ matchedRomEntries: 1201 }))).toBe(true)
		expect((await getSystemAudit(db, 'rb1', 'snes'))?.matchedRomEntries).toBe(1201)
	})

	it('lists every system of a Recalbox and nobody else’s', async () => {
		await upsertSystemAudit(db, audit())
		await upsertSystemAudit(db, audit({ system: 'nes' }))
		await upsertSystemAudit(db, audit({ recalboxId: 'rb2' }))
		expect(await listSystemAudits(db, 'rb1')).toHaveLength(2)
	})

	it('returns null for a system never audited', async () => {
		expect(await getSystemAudit(db, 'rb1', 'psx')).toBeNull()
	})
})

describe('scan lifecycle', () => {
	let db: DB
	beforeEach(() => {
		db = makeDb()
	})

	it('creates a running scan for the ssh transport', async () => {
		const row = await createScan(db, 'rb1', 'ssh', 3, 'user1')
		expect(row.status).toBe('running')
		expect(row.transport).toBe('ssh')
		expect(row.systemsTotal).toBe(3)
		expect(row.systemsDone).toBe(0)
		expect(row.createdBy).toBe('user1')
	})

	// The agent has not picked the command up yet, so the scan is not running.
	it('creates a pending scan for the agent transport', async () => {
		const row = await createScan(db, 'rb1', 'agent', 3)
		expect(row.status).toBe('pending')
	})

	it('advances progress and bumps updatedAt', async () => {
		const row = await createScan(db, 'rb1', 'ssh', 3)
		await updateScanProgress(db, row.id, { systemsDone: 2, currentSystem: 'psx' })
		const after = await getScan(db, row.id)
		expect(after?.systemsDone).toBe(2)
		expect(after?.currentSystem).toBe('psx')
		expect(after?.status).toBe('running')
		expect((after?.updatedAt.getTime() ?? 0) >= row.updatedAt.getTime()).toBe(true)
	})

	it('closes a scan as done', async () => {
		const row = await createScan(db, 'rb1', 'ssh', 1)
		await finishScan(db, row.id, 'done')
		const after = await getScan(db, row.id)
		expect(after?.status).toBe('done')
		expect(after?.completedAt).toBeInstanceOf(Date)
		expect(after?.error).toBeNull()
	})

	it('closes a scan as failed with its reason', async () => {
		const row = await createScan(db, 'rb1', 'ssh', 1)
		await finishScan(db, row.id, 'failed', 'box unreachable')
		expect((await getScan(db, row.id))?.error).toBe('box unreachable')
	})

	it('returns the most recent scan of the box', async () => {
		await createScan(db, 'rb1', 'ssh', 1)
		await new Promise((r) => setTimeout(r, 1100))
		const second = await createScan(db, 'rb1', 'ssh', 2)
		await createScan(db, 'rb2', 'ssh', 1)
		expect((await getLatestScan(db, 'rb1'))?.id).toBe(second.id)
	})

	it('has no scan for a box that never ran one', async () => {
		expect(await getLatestScan(db, 'rb9')).toBeNull()
	})
})

describe('isScanStale', () => {
	// A self-hosted server restarted mid-scan leaves a 'running' row forever;
	// the UI must not show a scan in flight for eternity.
	it('flags a running scan whose progress stopped long ago', () => {
		const updatedAt = new Date(Date.now() - SCAN_STALE_MS - 1000)
		expect(isScanStale({ status: 'running', updatedAt })).toBe(true)
	})

	it('leaves a scan that just reported progress alone', () => {
		expect(isScanStale({ status: 'running', updatedAt: new Date() })).toBe(false)
	})

	it('never flags a finished scan', () => {
		const updatedAt = new Date(Date.now() - SCAN_STALE_MS - 1000)
		expect(isScanStale({ status: 'done', updatedAt })).toBe(false)
		expect(isScanStale({ status: 'failed', updatedAt })).toBe(false)
	})
})
```

- [ ] **Step 4: Lancer les tests, constater l'échec**

```bash
cd apps/dashboard && pnpm exec vitest run lib/db/__tests__/rom-audit-queries.test.ts
```

Attendu : échec à l'import de `../rom-audit-queries` (module absent).

- [ ] **Step 5: Écrire `lib/db/rom-audit-queries.ts`**

Points de conception qui font passer les tests :

- **`entryKey(path, innerName)`** — `innerName` vide ou nul → `path` ; sinon `` `${path}#${innerName}` ``.
- **`syncSystemRomFiles`** — charger les lignes existantes de `(recalboxId, system)`, les indexer par `entryKey`, puis comparer. La comparaison porte sur les colonnes de contenu **à l'exclusion de `scannedAt`** (un rescan change toujours cet horodatage ; le compter comme un changement ferait réécrire toute la collection à chaque passage — c'est le test « ignores a change of scannedAt only » qui garde ce point). Insérer les nouvelles clés, mettre à jour les lignes dont le contenu diffère, supprimer les clés absentes du nouveau jeu. Grouper les suppressions en un `inArray` par paquets de 500 pour rester sous la limite de variables SQLite ; idem pour les insertions.
- **`upsertSystemAudit`** — même logique, à l'échelle d'une ligne : lire l'existante, comparer tout sauf `scannedAt` (`matchedEntries` et `mounts` se comparent sur leur sérialisation JSON), n'écrire que si différent, renvoyer `true` si écrit.
- **`createScan`** — `randomUUID()` pour l'id, `status` = `'running'` si `transport === 'ssh'`, `'pending'` si `'agent'`, `startedAt = updatedAt = new Date()`.
- **`updateScanProgress`** — met à jour les champs fournis **et** `updatedAt`, et repasse `status` à `'running'` (première progression d'un scan agent). N'écrase pas `currentSystem` si la clé est absente du patch ; `null` explicite l'efface.
- **`finishScan`** — `status`, `completedAt`, `updatedAt`, `error` (`null` si non fourni).
- **`isScanStale`** — vrai seulement si `status === 'running' || status === 'pending'` **et** `now - updatedAt > SCAN_STALE_MS`. `SCAN_STALE_MS = 3 * 60 * 60 * 1000`.

- [ ] **Step 6: Faire passer les tests**

```bash
cd apps/dashboard && pnpm exec vitest run lib/db/__tests__/rom-audit-queries.test.ts
pnpm exec tsc --noEmit
```

Attendu : tous verts, zéro erreur de typage.

- [ ] **Step 7: Amender le spec**

Ajouter à `docs/superpowers/specs/2026-07-25-rom-audit-design.md`, après la section « Persistance », une sous-section « Amendement 2026-07-26 » qui consigne les trois écarts décrits en tête de ce plan (troisième table `rom_system_audits` et pourquoi, progression hors SSE et pourquoi, clé `entry_key` et pourquoi).

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/lib/db/schema.ts apps/dashboard/lib/db/rom-audit-queries.ts \
  apps/dashboard/lib/db/__tests__/rom-audit-queries.test.ts apps/dashboard/drizzle/migrations \
  docs/superpowers/specs/2026-07-25-rom-audit-design.md
git commit -m "feat(rom-audit): tables d'audit et écriture incrémentale"
```

---

## Task 2: Découpage des scans multi-systèmes

Le lot 2A a laissé une limite connue : au-delà d'une poignée de systèmes, la ligne de commande dépasse ce que l'exec SSH accepte, et `runScan` refuse proprement. Cette tâche lève la limite.

**Files:**
- Create: `apps/dashboard/lib/rom-audit/scan-batches.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/scan-batches.test.ts`
- Modify: `apps/dashboard/lib/rom-audit/scan-runner.ts`
- Modify: `apps/dashboard/lib/rom-audit/__tests__/scan-runner.test.ts`

**Interfaces:**
- Consumes: `ScanTarget` (`./scan-targets`), `ScanExecutor`, `runScan`, `MAX_COMMAND_BYTES` (`./scan-runner`)
- Produces:

```ts
// scan-batches.ts
export type ScanBatch = { systems: string[]; targets: ScanTarget[] }
export type BatchPlan = { batches: ScanBatch[]; oversized: string[] }
export function planScanBatches(targets: readonly ScanTarget[], maxCommandBytes?: number): BatchPlan

// scan-runner.ts (ajouts ; runScan et buildScanCommand restent inchangés)
export const MAX_COMMAND_BYTES: number
export type ScanBatchEvent =
	| { type: 'batch-ok'; systems: string[]; entries: ManifestEntry[]; stats: Record<string, number> }
	| { type: 'batch-failed'; systems: string[]; reason: string }
export type BatchedScanSummary = { batches: number; failedSystems: string[]; oversized: string[] }
export async function runScanBatched(
	ssh: ScanExecutor,
	targets: readonly ScanTarget[],
	onBatch: (event: ScanBatchEvent) => Promise<void> | void,
): Promise<BatchedScanSummary>
```

- [ ] **Step 1: Écrire les tests de `planScanBatches`**

`apps/dashboard/lib/rom-audit/__tests__/scan-batches.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { planScanBatches } from '../scan-batches'
import type { ScanTarget } from '../scan-targets'
import { buildScanCommand } from '../scan-runner'

const MOUNTS = ['/recalbox/share', '/recalbox/share/externals/usb0', '/recalbox/share/externals/usb1']

/** One system as the real box presents it: the same system on every mount. */
function system(id: string): ScanTarget[] {
	return MOUNTS.map((mount) => ({
		mount,
		system: id,
		romsPath: mount === '/recalbox/share' ? `${mount}/roms/${id}` : `${mount}/recalbox/roms/${id}`,
	}))
}

function targetsFor(count: number): ScanTarget[] {
	return Array.from({ length: count }, (_, i) => system(`system${i}`)).flat()
}

describe('planScanBatches', () => {
	it('keeps a small scan in a single batch', () => {
		const plan = planScanBatches(targetsFor(3))
		expect(plan.batches).toHaveLength(1)
		expect(plan.batches[0]?.systems).toEqual(['system0', 'system1', 'system2'])
		expect(plan.oversized).toEqual([])
	})

	// The real motivation: 126 systems across three mounts is far over the limit.
	it('splits a whole-box scan into several batches', () => {
		const plan = planScanBatches(targetsFor(126))
		expect(plan.batches.length).toBeGreaterThan(1)
		for (const batch of plan.batches) {
			expect(buildScanCommand(batch.targets).length).toBeLessThanOrEqual(8000)
		}
	})

	// A system split across two batches would be audited twice against the same
	// DAT, each half looking incomplete. The boundary must fall between systems.
	it('never splits one system across two batches', () => {
		const plan = planScanBatches(targetsFor(126))
		const seen = new Set<string>()
		for (const batch of plan.batches) {
			for (const s of batch.systems) {
				expect(seen.has(s)).toBe(false)
				seen.add(s)
			}
			for (const t of batch.targets) expect(batch.systems).toContain(t.system)
		}
		expect(seen.size).toBe(126)
	})

	it('covers every target exactly once', () => {
		const targets = targetsFor(40)
		const plan = planScanBatches(targets)
		const packed = plan.batches.flatMap((b) => b.targets)
		expect(packed).toHaveLength(targets.length)
		expect(new Set(packed.map((t) => `${t.mount}|${t.system}`)).size).toBe(targets.length)
	})

	it('is deterministic and orders systems predictably', () => {
		const a = planScanBatches(targetsFor(30))
		const b = planScanBatches(targetsFor(30))
		expect(a).toEqual(b)
	})

	// Degenerate but possible: one system whose paths alone blow the budget.
	// It must be reported, not silently dropped and not packed into a doomed batch.
	it('reports a system that cannot fit in any batch', () => {
		const huge: ScanTarget = {
			mount: '/recalbox/share',
			system: 'huge',
			romsPath: `/recalbox/share/roms/${'x'.repeat(9000)}`,
		}
		const plan = planScanBatches([huge, ...system('snes')])
		expect(plan.oversized).toEqual(['huge'])
		expect(plan.batches.flatMap((b) => b.systems)).toEqual(['snes'])
	})

	it('accepts an empty target list', () => {
		expect(planScanBatches([])).toEqual({ batches: [], oversized: [] })
	})
})
```

- [ ] **Step 2: Écrire les tests de `runScanBatched`**

À ajouter à `apps/dashboard/lib/rom-audit/__tests__/scan-runner.test.ts` (les blocs existants restent tels quels) :

```ts
describe('runScanBatched', () => {
	function targetsFor(count: number): ScanTarget[] {
		return Array.from({ length: count }, (_, i) => ({
			mount: '/recalbox/share/externals/usb0',
			system: `system${i}`,
			romsPath: `/recalbox/share/externals/usb0/recalbox/roms/system${i}`,
		}))
	}

	it('runs several commands and reports each batch as it completes', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: { scanned: 3 } }))
		const events: string[][] = []
		const summary = await runScanBatched(client, targetsFor(200), (e) => {
			events.push(e.systems)
		})
		expect(summary.batches).toBeGreaterThan(1)
		expect(client.exec.mock.calls.length).toBe(summary.batches)
		expect(events.flat()).toHaveLength(200)
		expect(summary.failedSystems).toEqual([])
	})

	it('hands the caller the entries of each batch', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [VALID_ENTRY], stats: {} }))
		const seen: number[] = []
		await runScanBatched(client, targetsFor(2), (e) => {
			if (e.type === 'batch-ok') seen.push(e.entries.length)
		})
		expect(seen).toEqual([1])
	})

	// A 17-minute scan must not be thrown away because its last batch failed —
	// but the systems of the failed batch must NOT be reported as scanned, or
	// they would persist as "everything missing".
	it('keeps going after a failed batch and names its systems', async () => {
		let call = 0
		const client = ssh(async () => {
			call++
			if (call === 2) throw new Error('ECONNRESET')
			return JSON.stringify({ entries: [], stats: {} })
		})
		const ok: string[] = []
		const failed: string[] = []
		const summary = await runScanBatched(client, targetsFor(200), (e) => {
			if (e.type === 'batch-ok') ok.push(...e.systems)
			else failed.push(...e.systems)
		})
		expect(failed.length).toBeGreaterThan(0)
		expect(summary.failedSystems).toEqual(failed)
		expect(ok.some((s) => failed.includes(s))).toBe(false)
	})

	it('surfaces systems too large to batch without running them', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		const huge = {
			mount: '/recalbox/share',
			system: 'huge',
			romsPath: `/recalbox/share/roms/${'x'.repeat(9000)}`,
		}
		const summary = await runScanBatched(client, [huge], () => {})
		expect(summary.oversized).toEqual(['huge'])
		expect(client.exec).not.toHaveBeenCalled()
	})

	it('never throws when the callback itself throws', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: {} }))
		await expect(
			runScanBatched(client, targetsFor(2), () => {
				throw new Error('persist failed')
			}),
		).resolves.toBeDefined()
	})
})
```

Ajouter `runScanBatched` à l'import en tête du fichier, et `import type { ScanTarget } from '../scan-targets'` est déjà présent.

- [ ] **Step 3: Lancer les deux fichiers, constater l'échec**

```bash
cd apps/dashboard && pnpm exec vitest run lib/rom-audit/__tests__/scan-batches.test.ts lib/rom-audit/__tests__/scan-runner.test.ts
```

- [ ] **Step 4: Implémenter**

`planScanBatches` : grouper les cibles par système (ordre de tri stable sur l'identifiant), mesurer chaque système avec `buildScanCommand(targetsDuSystème)`, écarter dans `oversized` ceux dont la commande seule dépasse le budget, puis remplir les lots en additionnant les tailles — un système entre dans le lot courant si la commande du lot résultant tient sous `maxCommandBytes` (défaut : `MAX_COMMAND_BYTES`), sinon il ouvre un nouveau lot. Mesurer la commande réelle du lot plutôt que d'additionner des estimations : c'est `buildScanCommand` qui décide, et lui seul.

`runScanBatched` : planifier, puis pour chaque lot appeler `runScan` et émettre `batch-ok` ou `batch-failed` selon le résultat. Le callback est attendu (`await`) et **protégé par un try/catch** : une persistance qui échoue ne doit pas emporter le scan. `oversized` remonte tel quel dans le résumé. Exporter `MAX_COMMAND_BYTES` (aujourd'hui privé) pour que le planificateur et les tests parlent du même nombre.

- [ ] **Step 5: Vérifier**

```bash
cd apps/dashboard && pnpm exec vitest run lib/rom-audit/
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/rom-audit/scan-batches.ts apps/dashboard/lib/rom-audit/scan-runner.ts \
  apps/dashboard/lib/rom-audit/__tests__/
git commit -m "feat(rom-audit): découpe un scan multi-systèmes en lots exécutables"
```

---

## Task 3: Politique de persistance (détail local, agrégats dans le cloud)

**Files:**
- Create: `apps/dashboard/lib/rom-audit/persist.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/persist.test.ts`

**Interfaces:**
- Consumes: `AuditResult`, `MatchedFile` (`./match`), `RomFileRow`, `RomSystemAuditRow`, `entryKey` (`@/lib/db/rom-audit-queries`)
- Produces:

```ts
export type PersistPolicy = 'detail' | 'aggregates'
export function persistPolicyFor(serverless: boolean): PersistPolicy
export function auditToSystemRow(
	recalboxId: string,
	result: AuditResult,
	mounts: readonly string[],
	scannedAt: Date,
): RomSystemAuditRow
export function auditToFileRows(
	recalboxId: string,
	result: AuditResult,
	policy: PersistPolicy,
	scannedAt: Date,
): RomFileRow[]
```

- [ ] **Step 1: Écrire les tests**

`apps/dashboard/lib/rom-audit/__tests__/persist.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import type { AuditResult, MatchedFile } from '../match'
import { auditToFileRows, auditToSystemRow, persistPolicyFor } from '../persist'

const SCANNED_AT = new Date('2026-07-26T10:00:00Z')

function matched(over: Partial<MatchedFile> = {}): MatchedFile {
	return {
		path: '/recalbox/share/roms/snes/Game.zip',
		size: 1048576,
		mtime: 1721900000,
		system: 'snes',
		mount: '/recalbox/share',
		kind: 'zip-entry',
		crc32: 'e95a3dd7',
		innerName: 'Game (Europe).sfc',
		matchLevel: 'verified',
		datEntryName: 'Game (Europe).sfc',
		canonicalTitle: 'Game',
		...over,
	} as MatchedFile
}

function result(files: MatchedFile[], over: Partial<AuditResult> = {}): AuditResult {
	return {
		system: 'snes',
		datName: 'Nintendo - Super Nintendo Entertainment System',
		datVersion: '2026.05.02',
		totalRomEntries: 4000,
		matchedRomEntries: files.filter((f) => f.matchLevel !== 'unknown').length,
		files,
		games: [],
		missingGames: [],
		...over,
	}
}

describe('persistPolicyFor', () => {
	it('keeps the full detail on a self-hosted deploy', () => {
		expect(persistPolicyFor(false)).toBe('detail')
	})

	// The user's explicit choice: the cloud gets aggregates, never 75k rows.
	it('keeps only aggregates in the cloud', () => {
		expect(persistPolicyFor(true)).toBe('aggregates')
	})
})

describe('auditToSystemRow', () => {
	it('counts the files by match level', () => {
		const row = auditToSystemRow(
			'rb1',
			result([
				matched(),
				matched({ path: '/b.zip', matchLevel: 'named' }),
				matched({ path: '/c.rvz', matchLevel: 'serial', innerName: undefined }),
				matched({ path: '/d.zip', matchLevel: 'unknown', datEntryName: undefined }),
			]),
			['/recalbox/share'],
			SCANNED_AT,
		)
		expect(row.verifiedCount).toBe(1)
		expect(row.namedCount).toBe(1)
		expect(row.serialCount).toBe(1)
		expect(row.unknownCount).toBe(1)
		expect(row.filesScanned).toBe(4)
	})

	it('carries the catalogue identity and the raw metric', () => {
		const row = auditToSystemRow('rb1', result([matched()]), ['/recalbox/share'], SCANNED_AT)
		expect(row.datName).toBe('Nintendo - Super Nintendo Entertainment System')
		expect(row.datVersion).toBe('2026.05.02')
		expect(row.totalRomEntries).toBe(4000)
		expect(row.matchedRomEntries).toBe(1)
		expect(row.recalboxId).toBe('rb1')
		expect(row.system).toBe('snes')
		expect(row.scannedAt).toBe(SCANNED_AT)
	})

	// This list is what makes the missing-games view computable without ever
	// reading rom_files — it is the reason the cloud can drop the detail.
	it('lists the matched dat entries, deduplicated and sorted', () => {
		const row = auditToSystemRow(
			'rb1',
			result([
				matched({ datEntryName: 'B.sfc' }),
				matched({ path: '/b.zip', datEntryName: 'A.sfc' }),
				matched({ path: '/c.zip', datEntryName: 'A.sfc' }),
				matched({ path: '/d.zip', matchLevel: 'unknown', datEntryName: undefined }),
			]),
			['/recalbox/share'],
			SCANNED_AT,
		)
		expect(row.matchedEntries).toEqual(['A.sfc', 'B.sfc'])
	})

	it('sums the scanned bytes and keeps the mounts', () => {
		const row = auditToSystemRow(
			'rb1',
			result([matched({ size: 100 }), matched({ path: '/b.zip', size: 200 })]),
			['/recalbox/share', '/recalbox/share/externals/usb0'],
			SCANNED_AT,
		)
		expect(row.totalBytes).toBe(300)
		expect(row.mounts).toEqual(['/recalbox/share', '/recalbox/share/externals/usb0'])
	})

	// A system with no catalogue is inventory-only: a valid, expected state.
	it('accepts a system with no catalogue', () => {
		const row = auditToSystemRow(
			'rb1',
			result([matched({ matchLevel: 'unknown', datEntryName: undefined })], {
				datName: '',
				datVersion: '',
				totalRomEntries: 0,
				matchedRomEntries: 0,
			}),
			['/recalbox/share'],
			SCANNED_AT,
		)
		expect(row.totalRomEntries).toBe(0)
		expect(row.unknownCount).toBe(1)
		expect(row.matchedEntries).toEqual([])
	})
})

describe('auditToFileRows', () => {
	const files = [
		matched(),
		matched({ path: '/b.zip', matchLevel: 'named' }),
		matched({ path: '/c.zip', matchLevel: 'unknown', datEntryName: undefined }),
	]

	it('keeps every file in detail mode', () => {
		expect(auditToFileRows('rb1', result(files), 'detail', SCANNED_AT)).toHaveLength(3)
	})

	it('keeps only the unknown files in aggregates mode', () => {
		const rows = auditToFileRows('rb1', result(files), 'aggregates', SCANNED_AT)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.matchLevel).toBe('unknown')
	})

	it('builds a distinct key for two entries of the same archive', () => {
		const rows = auditToFileRows(
			'rb1',
			result([
				matched({ path: '/set.7z', innerName: 'A.nes', kind: 'sevenzip-entry' }),
				matched({ path: '/set.7z', innerName: 'B.nes', kind: 'sevenzip-entry' }),
			]),
			'detail',
			SCANNED_AT,
		)
		expect(new Set(rows.map((r) => r.entryKey)).size).toBe(2)
	})

	it('maps every column the audit produced', () => {
		const rows = auditToFileRows(
			'rb1',
			result([matched({ sha1: 'a'.repeat(40), serial: 'DL-DOL-GW7P-EUR' })]),
			'detail',
			SCANNED_AT,
		)
		const row = rows[0]
		expect(row?.recalboxId).toBe('rb1')
		expect(row?.system).toBe('snes')
		expect(row?.mount).toBe('/recalbox/share')
		expect(row?.path).toBe('/recalbox/share/roms/snes/Game.zip')
		expect(row?.innerName).toBe('Game (Europe).sfc')
		expect(row?.kind).toBe('zip-entry')
		expect(row?.crc32).toBe('e95a3dd7')
		expect(row?.sha1).toBe('a'.repeat(40))
		expect(row?.serial).toBe('DL-DOL-GW7P-EUR')
		expect(row?.matchLevel).toBe('verified')
		expect(row?.datEntryName).toBe('Game (Europe).sfc')
		expect(row?.canonicalTitle).toBe('Game')
		expect(row?.scannedAt).toBe(SCANNED_AT)
	})

	// Drizzle writes `undefined` as "column absent", which on an update leaves the
	// previous value in place — an optional field must become an explicit null.
	it('turns an absent optional field into null, never undefined', () => {
		const rows = auditToFileRows(
			'rb1',
			result([matched({ matchLevel: 'unknown', datEntryName: undefined, innerName: undefined })]),
			'detail',
			SCANNED_AT,
		)
		expect(rows[0]?.datEntryName).toBeNull()
		expect(rows[0]?.innerName).toBeNull()
		expect(rows[0]?.canonicalTitle ?? null).not.toBeUndefined()
	})

	it('accepts an empty audit', () => {
		expect(auditToFileRows('rb1', result([]), 'detail', SCANNED_AT)).toEqual([])
	})
})
```

- [ ] **Step 2: Lancer, constater l'échec**

```bash
cd apps/dashboard && pnpm exec vitest run lib/rom-audit/__tests__/persist.test.ts
```

- [ ] **Step 3: Implémenter `persist.ts`**

Module **pur** : aucun I/O, aucune lecture d'`process.env` — `persistPolicyFor` prend le booléen, l'appelant lui passe `isServerlessMode()`. C'est ce qui rend la politique testable dans les deux modes sans manipuler l'environnement.

Pièges couverts par les tests, à traiter explicitement : `undefined` → `null` sur toute colonne optionnelle ; `matchedEntries` dédupliqué et trié ; clé issue d'`entryKey`.

- [ ] **Step 4: Vérifier et committer**

```bash
cd apps/dashboard && pnpm exec vitest run lib/rom-audit/__tests__/persist.test.ts && pnpm exec tsc --noEmit
git add apps/dashboard/lib/rom-audit/persist.ts apps/dashboard/lib/rom-audit/__tests__/persist.test.ts
git commit -m "feat(rom-audit): politique de persistance détail local / agrégats cloud"
```

---

## Task 4: Découverte des cibles, orchestrateur self-hosted et route de scan

**Files:**
- Create: `apps/dashboard/lib/rom-audit/discover.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/discover.test.ts`
- Create: `apps/dashboard/lib/rom-audit/run-audit.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/run-audit.test.ts`
- Create: `apps/dashboard/app/api/rom-audit/scan/route.ts`
- Create: `apps/dashboard/app/api/rom-audit/__tests__/scan-route.test.ts`
- Modify: `apps/dashboard/scripts/rom-audit.ts` (consomme `discover.ts`)

**Interfaces:**
- Consumes: `runScanBatched` (tâche 2), `auditToSystemRow` / `auditToFileRows` / `persistPolicyFor` (tâche 3), `syncSystemRomFiles` / `upsertSystemAudit` / `createScan` / `updateScanProgress` / `finishScan` / `getLatestScan` / `isScanStale` (tâche 1), `loadDatForSystem` (`./catalog`), `auditSystem` (`./match`), `fetchStorageInfo` (`@/lib/recalbox/storage`), `buildScanTargets` / `romsRootFor` (`./scan-targets`), `getSshClient` (`@/lib/recalbox/ssh-client`), `enqueueCommand` (`@/lib/db/agent-commands`), `canControlRecalbox` / `canViewRecalbox`, `isServerlessMode`
- Produces:

```ts
// discover.ts
export type ListDirs = (root: string) => Promise<string[]>
export async function discoverScanTargets(host: string, listDirs: ListDirs, systems?: readonly string[]): Promise<ScanTarget[]>

// run-audit.ts
export type AuditPersist = (system: string, result: AuditResult, mounts: string[]) => Promise<void>
export type AuditDeps = {
	loadDat: (system: string) => Promise<CatalogResult>
	persist: AuditPersist
	onProgress: (done: number, total: number, current: string | null) => Promise<void>
}
export type AuditRunSummary = {
	systemsAudited: number
	systemsWithoutCatalog: string[]
	failedSystems: string[]
	oversized: string[]
}
export async function runAuditOverScan(ssh: ScanExecutor, targets: readonly ScanTarget[], deps: AuditDeps): Promise<AuditRunSummary>
export async function startSelfHostedScan(recalboxId: string, userId: string | null, systems?: readonly string[]): Promise<{ scanId: string }>
```

- [ ] **Step 1: Extraire la découverte des cibles**

`discoverScanTargets` reprend la logique aujourd'hui inline dans `scripts/rom-audit.ts` : `fetchStorageInfo(host)` pour les supports, `listDirs(romsRootFor(mount))` pour les dossiers, `buildScanTargets` pour l'assemblage, puis filtrage optionnel sur `systems`. L'injection de `listDirs` est ce qui rend la fonction testable sans box : le CLI passe un `ls -1` sur SSH, la route passe `getSshClient(id).exec(...)`.

Tests (`discover.test.ts`) — `fetchStorageInfo` est moqué via `vi.mock('@/lib/recalbox/storage')` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/recalbox/storage', () => ({ fetchStorageInfo: vi.fn() }))

import { fetchStorageInfo } from '@/lib/recalbox/storage'
import { discoverScanTargets } from '../discover'

const mounts = [{ mount: '/recalbox/share' }, { mount: '/recalbox/share/externals/usb0' }]

beforeEach(() => {
	vi.mocked(fetchStorageInfo).mockResolvedValue(mounts as never)
})

describe('discoverScanTargets', () => {
	it('lists the roms directories of every share', async () => {
		const listDirs = vi.fn(async () => ['snes', 'psx'])
		const targets = await discoverScanTargets('recalbox.local', listDirs)
		expect(listDirs).toHaveBeenCalledWith('/recalbox/share/roms')
		expect(listDirs).toHaveBeenCalledWith('/recalbox/share/externals/usb0/recalbox/roms')
		expect(targets).toHaveLength(4)
	})

	it('restricts to the requested systems', async () => {
		const targets = await discoverScanTargets('recalbox.local', async () => ['snes', 'psx'], ['psx'])
		expect(targets.every((t) => t.system === 'psx')).toBe(true)
		expect(targets).toHaveLength(2)
	})

	// A share that cannot be listed must not take the whole discovery down.
	it('skips a share whose listing fails', async () => {
		const listDirs = vi.fn(async (root: string) => {
			if (root.includes('usb0')) throw new Error('permission denied')
			return ['snes']
		})
		const targets = await discoverScanTargets('recalbox.local', listDirs)
		expect(targets).toHaveLength(1)
		expect(targets[0]?.mount).toBe('/recalbox/share')
	})

	it('returns nothing when no share is reported', async () => {
		vi.mocked(fetchStorageInfo).mockResolvedValue([] as never)
		expect(await discoverScanTargets('recalbox.local', async () => ['snes'])).toEqual([])
	})
})
```

- [ ] **Step 2: Câbler le CLI sur `discover.ts`**

`scripts/rom-audit.ts` supprime sa copie locale et appelle `discoverScanTargets(host, (root) => client.exec(\`ls -1 ${JSON.stringify(root)} 2>/dev/null || true\`).then(split), [system])`. Les messages d'erreur du CLI (aucun support, système introuvable avec la liste des systèmes disponibles) restent dans le CLI — c'est de la présentation, pas de la découverte.

Vérifier que le CLI marche toujours, sur la box si elle est joignable :

```bash
cd apps/dashboard && pnpm exec tsx scripts/rom-audit.ts --scan --system=gamegear
```

Attendu : même résultat qu'au lot 2A (808 entrées, 804 verified). Si la box est éteinte, l'attendu est le message « Recalbox injoignable », pas une stack trace.

- [ ] **Step 3: Écrire les tests de l'orchestrateur**

`run-audit.test.ts` teste `runAuditOverScan` avec un `ScanExecutor` factice et des `deps` espionnées. Contrats à couvrir :

```ts
describe('runAuditOverScan', () => {
	it('audits each system against its own catalogue and persists it', async () => { /* deux systèmes, deux appels persist, chacun avec son AuditResult */ })

	it('persists a system with no catalogue as inventory only', async () => { /* loadDat → status 'no-catalog' : persist appelé, totalRomEntries 0, aucun throw */ })

	// Ne jamais persister un système dont le scan a échoué : il apparaîtrait
	// comme intégralement manquant, ce qui est pire que pas de donnée du tout.
	it('does not persist a system whose batch failed', async () => { /* … */ })

	it('reports progress after each system', async () => { /* onProgress appelé avec done croissant et total constant */ })

	it('reports the systems it could not audit', async () => { /* failedSystems + oversized dans le résumé */ })

	it('keeps going when the catalogue download fails for one system', async () => { /* loadDat → 'unavailable' : ce système est compté dans systemsWithoutCatalog, les autres passent */ })

	it('never throws when persistence fails', async () => { /* persist rejette : le résumé revient, le système est marqué en échec */ })
})
```

L'implémenteur écrit ces tests en entier sur ce contrat ; les noms et la sémantique ci-dessus sont impératifs.

- [ ] **Step 4: Implémenter `run-audit.ts`**

`runAuditOverScan` : `runScanBatched` avec un callback qui, pour chaque `batch-ok`, regroupe `entries` par `system`, puis pour chaque système charge le DAT, appelle `auditSystem`, et appelle `deps.persist`. Un système sans catalogue produit un `AuditResult` d'inventaire (`datName: ''`, `datVersion: ''`, `totalRomEntries: 0`, tous les fichiers en `unknown`) — construit sans passer par `auditSystem`, qui exige un `Dat`. Progression émise après chaque système.

`startSelfHostedScan` : découvre les cibles, crée la ligne `rom_scans` (`transport: 'ssh'`, `systemsTotal` = nombre de systèmes distincts), lance `runAuditOverScan` **sans l'attendre** avec `getSshClient(recalboxId, 'rom-scan')` — la variante dédiée existe précisément pour qu'un scan de dix-sept minutes n'occupe pas l'un des deux créneaux d'exécution partagés par le reste de l'application. La persistance branche `persistPolicyFor(isServerlessMode())`, `auditToFileRows` + `syncSystemRomFiles`, `auditToSystemRow` + `upsertSystemAudit`. À la fin : `finishScan('done')`, ou `'failed'` avec la raison si **aucun** système n'a pu être audité. Renvoie l'identifiant du scan immédiatement.

- [ ] **Step 5: Écrire la route**

`app/api/rom-audit/scan/route.ts`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

**POST** — corps `{ recalboxId: string, systems?: string[] }` validé par Zod. Séquence : `getUser()` → 401 ; `canControlRecalbox` → 403 ; `configStore.getRecalbox(id)` absent → 404 ; un scan déjà en cours (`getLatestScan` avec un statut vivant et non périmé au sens d'`isScanStale`) → **409** avec l'identifiant du scan en cours. Puis, selon le mode :

- self-hosted → `startSelfHostedScan(...)`, réponse `{ scanId, transport: 'ssh' }` en 202 ;
- serverless → `createScan(db, id, 'agent', systemsTotal)` puis `enqueueCommand(db, id, 'scan', { scanId, systems })`, réponse `{ scanId, transport: 'agent' }` en 202.

En serverless, `systemsTotal` n'est pas connu du cloud (la découverte se fait sur la box) : passer `0`, l'agent le corrigera par sa première progression.

**GET** — `?recalboxId=` ; `canViewRecalbox` → 404 si non ; renvoie `{ scan, systems }` où `scan` est `getLatestScan` normalisé (`isScanStale` ⇒ `status: 'failed'`, `error: 'interrupted'`, **sans écriture en base** — la normalisation est une vue) et `systems` le nombre de lignes d'agrégat.

Tests de route : un fichier `app/api/rom-audit/__tests__/scan-route.test.ts` sur le modèle des tests de routes agent existants, couvrant 401 sans session, 403 sans droit de contrôle, 409 sur scan déjà en cours, 202 avec `scanId` en self-hosted, et en serverless la mise en file d'une commande `scan` (assertion sur `enqueueCommand`).

- [ ] **Step 6: Vérifier et committer**

```bash
cd apps/dashboard && pnpm exec vitest run lib/rom-audit/ app/api/rom-audit/ && pnpm exec tsc --noEmit && cd ../.. && pnpm lint
git add apps/dashboard/lib/rom-audit apps/dashboard/app/api/rom-audit apps/dashboard/scripts/rom-audit.ts
git commit -m "feat(rom-audit): orchestrateur self-hosted et route de déclenchement"
```

---

## Task 5: Ingestion du manifeste poussé par l'agent

**Files:**
- Modify: `apps/dashboard/lib/rom-audit/manifest.ts` (+ `__tests__/manifest.test.ts`)
- Modify: `apps/dashboard/lib/agent/commands.ts` (+ ses tests)
- Create: `apps/dashboard/app/api/agent/rom-scan/route.ts`
- Create: `apps/dashboard/app/api/agent/__tests__/rom-scan-route.test.ts`

**Interfaces:**
- Produces:

```ts
// manifest.ts
export type LenientManifest = { entries: ManifestEntry[]; rejected: number }
export function parseManifestLenient(input: unknown): LenientManifest

// commands.ts — variante ajoutée à l'union discriminée
z.object({ type: z.literal('scan'), scanId: z.string().min(1).max(64), systems: z.array(z.string().min(1).max(64)).max(256).optional() })
```

- [ ] **Step 1: Tolérance par entrée sur la frontière HTTP**

`parseManifest` est tout-ou-rien : une entrée invalide fait rejeter le tableau entier. C'est le bon contrat pour un scan local, où l'anomalie doit sauter aux yeux. C'est le mauvais contrat sur une route HTTP alimentée par une box distante : une entrée bizarre y ferait perdre le scan complet d'un système. Cette dette est ouverte depuis la revue finale du lot 1 ; elle se ferme ici.

Tests à ajouter à `manifest.test.ts` :

```ts
describe('parseManifestLenient', () => {
	it('keeps the valid entries and counts the rejected ones', () => { /* 2 valides + 1 kind inconnu → entries 2, rejected 1 */ })
	it('normalises exactly like parseManifest', () => { /* crc32 minuscule, serial majuscule */ })
	it('returns empty on a non-array input instead of throwing', () => { /* {} → { entries: [], rejected: 0 } */ })
	it('rejects everything without throwing when nothing is valid', () => { /* entries [], rejected n */ })
})
```

`parseManifest` reste inchangé et garde ses tests : deux contrats, deux fonctions, la stricte pour le scan local, la tolérante pour HTTP.

- [ ] **Step 2: Étendre l'allowlist de commandes**

Ajouter la variante `scan` à `commandSchema`. Le commentaire de l'allowlist explique déjà qu'elle est la définition autoritative côté serveur ; y ajouter une ligne sur `scan` : la commande ne porte **aucun chemin**, seulement une liste d'identifiants de systèmes bornée — la box découvre les chemins elle-même, donc rien de ce que le cloud envoie n'atteint un `open()`.

Test : une commande `scan` avec un `systems` contenant `../` ou un séparateur est refusée par le schéma (`z.string().max(64)` seul ne suffit pas — réutiliser la même contrainte que `systemId` du manifeste : ni `/` ni `\`).

- [ ] **Step 3: Écrire la route d'ingestion**

`app/api/agent/rom-scan/route.ts`, sur le modèle exact de `app/api/agent/collection/route.ts` : `getBearerToken` → 401, `resolveAgentToken` → 401, corps JSON → 400, Zod → 400.

Corps :

```ts
const Payload = z.object({
	scan_id: z.string().min(1).max(64),
	system: z.string().min(1).max(64),
	mounts: z.array(z.string().min(1)).max(16).optional(),
	entries: z.array(z.unknown()).max(20000),
	stats: z.record(z.string(), z.number()).optional(),
	// The agent sets this on the last chunk of the last system.
	final: z.boolean().optional(),
	// Set on the first chunk of a system so the scan row learns its real total.
	systems_total: z.number().int().nonnegative().optional(),
})
```

Traitement : vérifier que `scan_id` appartient bien à la Recalbox du token (sinon 404 — un agent ne peut pas alimenter le scan d'une autre box) ; `parseManifestLenient(entries)` ; charger le DAT du système ; `auditSystem` ou inventaire seul si pas de catalogue ; `auditToFileRows` + `syncSystemRomFiles`, `auditToSystemRow` + `upsertSystemAudit` avec `persistPolicyFor(isServerlessMode())` ; `updateScanProgress` ; sur `final`, `finishScan(scan_id, 'done')`.

**Chunking et accumulation.** Un système volumineux arrive en plusieurs requêtes. `syncSystemRomFiles` supprime ce qui n'est pas dans le lot fourni : appelé par chunk, il effacerait le chunk précédent. La route accumule donc les entrées d'un même `(scan_id, system)` avant de synchroniser — porté par un champ `chunk_index` / `chunk_count` dans le corps, et une synchronisation déclenchée **au dernier chunk du système uniquement**. Faire porter l'accumulation par la base : insérer les lignes du chunk sans suppression (`syncSystemRomFiles` prend une option `{ prune: boolean }`, `false` sur les chunks intermédiaires, `true` sur le dernier). Ajouter cette option à la tâche 1 si elle n'y est pas encore, avec son test : un `prune: false` n'efface rien, un `prune: true` final efface ce qui a disparu.

> **À trancher par l'implémenteur, à signaler dans le rapport :** si l'accumulation par option `prune` complique `syncSystemRomFiles` au point de menacer son invariant « zéro écriture sans changement », préférer l'alternative — un chunk = un système entier, et l'agent découpe par système, jamais à l'intérieur d'un système. La collection de référence donne au maximum ~10 000 entrées pour un système, soit un corps de quelques Mo, sous la limite Vercel. C'est la solution la plus simple et elle est probablement suffisante.

Tests de route : 401 sans token, 401 token invalide, 404 si le `scan_id` est celui d'une autre box, 201 nominal avec écriture de l'agrégat, entrées invalides comptées sans faire échouer la requête, `final` qui clôt le scan.

- [ ] **Step 4: Vérifier et committer**

```bash
cd apps/dashboard && pnpm exec vitest run lib/rom-audit lib/agent app/api/agent && pnpm exec tsc --noEmit
git commit -m "feat(rom-audit): ingestion chunkée du manifeste poussé par l'agent"
```

---

## Task 6: Exécution du scan par l'agent on-box

**Files:**
- Modify: `agent/agent.py`
- Create: `agent/__tests__/test_agent_scan.py`
- Modify: `agent/README.md`, `docs/serverless-deploy.md`

**Interfaces:**
- Consumes: `scan_roms.scan(targets)` (module voisin, lot 2A), `/api/agent/rom-scan` (tâche 5)
- Produces, dans `agent.py` :

```python
def discover_scan_targets(systems=None)   # → list of "mount|system|roms_path" strings
def exec_scan(cfg, payload)               # → (ok, message), returns immediately
def run_scan_job(cfg, scan_id, systems)   # runs in its own thread, posts chunked
```

- [ ] **Step 1: Écrire les tests Python**

`agent/__tests__/test_agent_scan.py`, sur le modèle de `test_scan_roms.py` (`sys.path.insert` sur `agent/`, `unittest`, arborescence temporaire). Contrats :

```python
class DiscoverTargetsTest(unittest.TestCase):
    # La carte SD ET les disques externes — le défaut de listSystems() que le
    # spec relève explicitement : ne scanner que externals/usb* rate la SD.
    def test_finds_systems_on_share_and_externals(self): ...
    def test_ignores_a_share_with_no_roms_directory(self): ...
    def test_restricts_to_the_requested_systems(self): ...
    def test_skips_files_and_keeps_directories(self): ...

class ScanJobTest(unittest.TestCase):
    def test_posts_one_request_per_system(self): ...
    def test_marks_only_the_last_request_final(self): ...
    def test_reports_the_scan_id_it_was_given(self): ...
    # Un agent dont scan_roms.py n'a pas été déployé doit le dire, pas crasher.
    def test_missing_scan_module_reports_a_clean_failure(self): ...
    # Deux commandes de scan qui se chevauchent doubleraient la charge disque.
    def test_a_second_scan_is_refused_while_one_runs(self): ...
    # Le thread de commandes ne doit pas rester bloqué 17 minutes.
    def test_exec_scan_returns_immediately(self): ...
```

Les POST se testent en monkeypatchant `agent.http_post_json` par une fonction qui enregistre les appels.

- [ ] **Step 2: Implémenter dans `agent.py`**

- `discover_scan_targets` — supports : `/recalbox/share`, plus chaque `/recalbox/share/externals/*` contenant un dossier `recalbox/roms`. Racine des roms : `/recalbox/share/roms` pour la SD, `<mount>/recalbox/roms` pour un externe (même règle que `romsRootFor` côté TS). Systèmes : sous-dossiers de la racine, filtrés par `systems` si fourni. Aucune exception ne remonte : un support illisible est ignoré, journalisé.
- `exec_scan` — vérifie qu'aucun scan ne tourne (verrou de module `threading.Lock` + drapeau), démarre `run_scan_job` dans un `threading.Thread(daemon=True)`, renvoie `(True, 'scan started')` **immédiatement**. La boucle de commandes continue son polling : un scan complet dure une quinzaine de minutes et ne doit pas geler les autres commandes.
- `run_scan_job` — importe `scan_roms` (échec d'import → `finishScan` côté cloud via un POST `final` portant l'erreur, et log clair : « scan_roms.py absent, redéployez l'agent ») ; pour chaque système, appelle `scan_roms.scan([target…])` et POSTe le résultat sur `rom-scan` avec `scan_id`, `system`, `mounts`, `entries`, `stats`, `systems_total` sur le premier envoi et `final=True` sur le dernier. Ne jamais laisser le thread mourir sur une exception : journaliser et poursuivre au système suivant.
- Câbler `'scan'` dans `execute_command`.
- `endpoint_for(cfg, "rom-scan")` doit résoudre comme les autres routes agent.

- [ ] **Step 3: Documenter le déploiement**

`agent/README.md` : `scan_roms.py` est désormais **requis à côté d'`agent.py`**. Ajouter la ligne `scp scan_roms.py root@$RB:/recalbox/share/system/sr-agent/scan_roms.py` au bloc d'installation, et une note « un agent mis à jour sans ce fichier refusera les commandes de scan avec un message explicite ». Même ajout dans `docs/serverless-deploy.md` là où l'installation de l'agent est décrite.

- [ ] **Step 4: Vérifier et committer**

```bash
python3 -m unittest discover -s agent/__tests__ -v
git add agent/ docs/serverless-deploy.md
git commit -m "feat(agent): exécution du scan ROM on-box et push chunké"
```

---

## Task 7: API de lecture — vue d'ensemble, détail, export

**Files:**
- Modify: `apps/dashboard/lib/rom-audit/match.ts` (+ tests)
- Create: `apps/dashboard/lib/rom-audit/report.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/report.test.ts`
- Create: `apps/dashboard/app/api/rom-audit/systems/route.ts`
- Create: `apps/dashboard/app/api/rom-audit/systems/[system]/route.ts`
- Create: `apps/dashboard/app/api/rom-audit/export/route.ts`

**Interfaces:**
- Produces:

```ts
// match.ts — extraits, réutilisés par report.ts ; auditSystem est réécrit dessus
export function groupCanonicalGames(dat: Dat): CanonicalGame[]
export function markOwned(games: readonly CanonicalGame[], matchedEntryNames: ReadonlySet<string>): CanonicalGame[]

// report.ts
export type SystemOverview = {
	system: string
	datName: string | null
	datVersion: string | null
	totalRomEntries: number
	matchedRomEntries: number
	percent: number
	verified: number
	serial: number
	named: number
	unknown: number
	filesScanned: number
	totalBytes: number
	mounts: string[]
	scannedAt: string
}
export function toOverview(row: RomSystemAuditRow): SystemOverview
export function missingGamesFor(dat: Dat, matchedEntryNames: readonly string[], filters?: MissingFilters): CanonicalGame[]
export function missingGamesToCsv(system: string, games: readonly CanonicalGame[]): string
```

- [ ] **Step 1: Extraire le regroupement de `auditSystem`**

`auditSystem` construit aujourd'hui les `CanonicalGame` en interne. `report.ts` a besoin du même regroupement à partir du seul DAT, sans manifeste. Extraire `groupCanonicalGames(dat)` (tous `owned: false`) et `markOwned(games, matchedNames)` (recopie en marquant possédé tout jeu dont au moins une entrée est matchée, et en calculant `ownedDiscs` / `missingDiscs`), puis réécrire `auditSystem` par-dessus. **Les tests existants de `match.ts` doivent rester verts sans modification** : c'est la preuve que l'extraction n'a rien changé au comportement. Ajouter les tests propres aux deux nouvelles fonctions publiques.

- [ ] **Step 2: Écrire `report.ts` et ses tests**

Contrats :

```ts
describe('toOverview', () => {
	it('computes the raw percentage', () => { /* 1200/4000 → 30 */ })
	it('reports 0 % for a system with no catalogue', () => { /* totalRomEntries 0 → percent 0, pas de NaN ni de division par zéro */ })
})

describe('missingGamesFor', () => {
	it('returns the games no matched entry covers', () => { /* … */ })
	it('treats a game as owned as soon as one of its roms is matched', () => { /* règle du spec */ })
	it('applies the region filter', () => { /* … */ })
	it('returns the whole catalogue when nothing is matched', () => { /* … */ })
	it('returns nothing when everything is matched', () => { /* … */ })
})

describe('missingGamesToCsv', () => {
	it('emits the header the spec asks for', () => { /* titre canonique, région, nom d'entrée DAT, taille, CRC32, MD5, SHA1, serial */ })
	it('quotes a title containing a comma or a quote', () => { /* injection CSV élémentaire */ })
	// Une valeur commençant par =, +, - ou @ est interprétée comme une formule
	// par Excel : la préfixer d'une apostrophe.
	it('neutralises a formula-looking value', () => { /* … */ })
})
```

- [ ] **Step 3: Écrire les trois routes**

Toutes en `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, derrière `getUser()` + `canViewRecalbox`.

- `GET /api/rom-audit/systems?recalboxId=` → `{ systems: SystemOverview[] }`, trié par identifiant de système. Lit **uniquement** `rom_system_audits` : une requête, aucune lecture de `rom_files`.
- `GET /api/rom-audit/systems/[system]?recalboxId=&tab=missing|owned|unknown&region=&limit=&offset=` :
  - `missing` → charge le DAT depuis le cache, `missingGamesFor(dat, row.matchedEntries, filters)`, pagination appliquée après filtrage ; si le système n'a pas d'agrégat → 404 ; s'il n'a pas de catalogue → `{ games: [], reason: 'no-catalog' }` ;
  - `owned` / `unknown` → `listRomFiles` avec le niveau demandé ; en serverless, `owned` renvoie `{ files: [], reason: 'aggregates-only' }` — la donnée n'existe pas dans le cloud, et le dire est plus honnête qu'une liste vide sans explication.
  - `limit` borné (défaut 200, max 1000).
- `GET /api/rom-audit/export?recalboxId=&system=&format=csv|json&region=` → même calcul que l'onglet `missing`, sérialisé. En CSV : `Content-Type: text/csv; charset=utf-8` et `Content-Disposition: attachment; filename="rom-audit-<system>.csv"`.

Tests de route : 401, 404 sur box non visible, 404 sur système jamais audité, `no-catalog`, `aggregates-only` en serverless, en-têtes de l'export CSV.

- [ ] **Step 4: Vérifier et committer**

```bash
cd apps/dashboard && pnpm exec vitest run lib/rom-audit app/api/rom-audit && pnpm exec tsc --noEmit
git commit -m "feat(rom-audit): api de lecture et export des manquants"
```

---

## Task 8: Page d'audit

**Files:**
- Create: `apps/dashboard/app/[locale]/collection/audit/page.tsx`
- Create: `apps/dashboard/components/rom-audit/audit-overview.tsx`
- Create: `apps/dashboard/components/rom-audit/audit-system-detail.tsx`
- Create: `apps/dashboard/components/rom-audit/scan-button.tsx`
- Create: `apps/dashboard/components/rom-audit/__tests__/scan-button.test.tsx`
- Modify: `apps/dashboard/app/[locale]/collection/page.tsx` (lien vers l'audit)
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/fr.json`

**Interfaces:**
- Consomme les routes de la tâche 7 et `GET/POST /api/rom-audit/scan` de la tâche 4.

- [ ] **Step 1: Page serveur**

`page.tsx` — composant serveur, `setRequestLocale`, `getActiveRecalboxId()`, lecture directe de `listSystemAudits` (pas de fetch HTTP interne). Affiche l'en-tête (nombre de systèmes audités, date du dernier scan), le `ScanButton`, puis `AuditOverview`. Si aucun scan n'a jamais tourné : un état vide qui explique ce que fait le scan et combien de temps il peut prendre (~17 min au premier passage sur une grosse collection).

Suivre le style de `app/[locale]/collection/page.tsx` : `container mx-auto max-w-6xl space-y-6 px-4 py-8`, `Separator`, composants `components/ui/`.

- [ ] **Step 2: Vue d'ensemble**

`AuditOverview` — une carte par système : nom, taux brut en évidence, barre de répartition vérifié / serial / nom / inconnu avec la légende des badges du spec (✅ vérifié, ◆ serial, ~ nom, ? inconnu), supports physiques, nombre de fichiers. Un système sans catalogue affiche « inventaire seul » à la place du pourcentage — jamais « 0 % », qui se lirait comme une collection vide.

- [ ] **Step 3: Détail d'un système**

`AuditSystemDetail` — client, trois onglets, **`Manquants` par défaut** (c'est la liste exploitable, le spec est explicite). Filtre région et filtre catégorie sur l'onglet manquants ; chaque ligne se déplie sur les entrées DAT du groupe (nom, taille, CRC32). Onglets `Possédés` et `Inconnus` paginés. Bouton d'export reprenant les filtres courants.

- [ ] **Step 4: Bouton de scan**

`ScanButton` — client. POST sur `/api/rom-audit/scan`, puis **polling de `GET /api/rom-audit/scan` toutes les 3 s tant que le statut est `pending` ou `running`**, arrêt sur `done` / `failed`, et rafraîchissement de la page (`router.refresh()`) à la fin. Affiche `systemsDone / systemsTotal` et le système courant. Un 409 (scan déjà en cours) bascule directement en mode suivi au lieu d'afficher une erreur.

Tests (`scan-button.test.tsx`, Testing Library, `fetch` moqué) :

```
it('starts a scan and switches to progress mode')
it('polls until the scan is done, then stops')       // vi.useFakeTimers ; compter les appels
it('follows the running scan when the server answers 409')
it('shows the error of a failed scan')
it('stops polling when unmounted')                   // pas de timer qui fuit
```

- [ ] **Step 5: i18n**

Ajouter la section `romAudit` à `messages/en.json` **et** `messages/fr.json` — mêmes clés des deux côtés. Aucune chaîne en dur dans les composants.

- [ ] **Step 6: Lien depuis la collection**

Ajouter dans l'en-tête de `app/[locale]/collection/page.tsx` un lien vers `/collection/audit`, à côté du lien `Multi-disc / .m3u` existant et dans le même style (`buttonVariants({ variant: 'outline', size: 'sm' })`).

- [ ] **Step 7: Vérifier et committer**

```bash
cd apps/dashboard && pnpm exec vitest run && pnpm exec tsc --noEmit
cd ../.. && pnpm lint && pnpm build
git add apps/dashboard/app apps/dashboard/components apps/dashboard/messages
git commit -m "feat(rom-audit): page d'audit de collection"
```

---

## Recette finale

Après la tâche 8, sur la box réelle si elle est joignable :

- [ ] Scan d'un système déjà connu (`gamegear`) depuis l'UI : le résultat doit égaler celui du CLI au lot 2A — 808 entrées, 804 `verified`, 77 jeux manquants.
- [ ] **Rescan immédiat du même système** : la seconde passe doit écrire **zéro ligne**. Le vérifier autrement que par les tests — par exemple en comparant `SELECT total_changes()` autour de la passe sur la base locale, ou en instrumentant temporairement `syncSystemRomFiles`. C'est la promesse centrale du lot envers le quota Turso.
- [ ] Scan de `psx` (chemin CHD) et de `nes` (chemin 7z, ~800 archives) : niveaux de match cohérents avec le lot 2A, aucune erreur.
- [ ] Scan multi-systèmes (≥ 10 systèmes) : plusieurs lots exécutés, progression qui avance, aucun « Unable to exec ».
- [ ] Export CSV d'un système ouvert dans un tableur : pas de colonne décalée, pas de formule interprétée.

## Dette et limites connues à l'entrée du lot

Reportées du lot 1 et du lot 2A, à garder au tableau :

- **Parser DAT non streaming** — le spec l'exige, ce n'est pas fait. Bloque MAME. Lot 2C.
- **Deep verify** — hors périmètre ici, lot 2C.
- **Incrémentalité côté scan — non traitée, et le transport SSH s'y oppose.** Le spec prévoit de réutiliser le manifeste précédent comme cache `(path, size, mtime)` pour éviter de relire les fichiers nus. Ce lot livre l'incrémentalité **en écriture** (un rescan sans changement n'écrit rien), pas **en lecture**. L'obstacle est concret : le script Python occupe déjà le stdin de l'exec — `python3 -` consomme tout le flux comme source — et la ligne de commande plafonne à 8 Ko, donc il n'existe aujourd'hui aucun canal pour pousser 75 000 lignes de cache vers la box, et en écrire un fichier là-bas est interdit par le périmètre. Deux issues à instruire au lot 2C : faire du cache un paramètre du transport **agent** seulement (là où le scan tourne sur la box, qui peut tenir son propre cache local dans `/recalbox/share/system/sr-agent/`), ou déplacer le script vers un fichier temporaire hors `/recalbox/share` — ce qui rouvre la question de l'écriture sur la box et doit alors être tranché explicitement. Effet mesuré de l'absence de cache : nul sur les stratégies 1 à 4 (zip, CHD, RVZ, 7z sont déjà gratuites), sensible uniquement sur les fichiers nus.
- `DatGame.region` et `broadcastStandards` sont produits mais peu consommés ; la tâche 7 branche `region` sur les filtres, `broadcastStandards` reste inutilisé.
- Le cache des catalogues n'est pas atomique en cas d'appels concurrents sur la même clé (mineur non traité du lot 1, tâche 6).
