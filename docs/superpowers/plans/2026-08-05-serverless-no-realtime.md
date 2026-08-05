# Suppression du temps réel en mode serverless — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer le flux SSE en mode serverless — l'état live est calculé côté serveur au chargement de page au lieu d'interroger Turso en boucle pour chaque onglet ouvert.

**Architecture:** `RecalboxEventsProvider` reçoit deux props, `live` et `initialState`. Quand `live` est faux il n'ouvre jamais d'`EventSource` : son état initial vient d'un calcul RSC (`getNowPlaying` + `getAgentLastSeen`) fait dans le layout. La route `/api/events` répond `204` en serverless, et l'agent cesse de pousser des snapshots système — coupés aussi côté serveur pour ne dépendre d'aucune mise à jour de box. Le mode self-hosted reste strictement identique.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript, Drizzle ORM (SQLite/libSQL), Vitest (environnement `node`), next-intl, Python 3 stdlib (agent).

**Spec:** `docs/superpowers/specs/2026-08-05-serverless-no-realtime-design.md`

## Global Constraints

- **Branche de travail :** `feat/serverless-no-realtime` (déjà créée, contient la spec).
- **Style Biome, non négociable :** tabulations pour l'indentation, guillemets simples, **pas de point-virgule**, virgules finales. Lancer `pnpm lint` depuis la racine du dépôt.
- **Pas de test de composant React.** Le projet n'a ni `jsdom` ni `@testing-library` ; `vitest.config.ts` fixe `environment: 'node'`. **Ne pas ajouter ces dépendances.** La logique testable doit être extraite dans des modules purs sous `lib/`, exactement comme `lib/sse/reconnect-delay.ts` l'a déjà été (son en-tête dit explicitement « so this stays unit-testable without a DOM »).
- **Tests TS :** fichiers dans un sous-dossier `__tests__/` voisin du code. Lancer depuis `apps/dashboard` avec `pnpm exec vitest run <chemin>` (il n'y a pas de script `vitest`).
- **Tests Python :** stdlib `unittest` uniquement, l'agent est volontairement sans dépendance. Lancer depuis la racine du dépôt : `python3 -m unittest discover -s agent -v`.
- **Le mode serverless est détecté par** `isServerlessMode()` (`lib/serverless.ts`), qui lit `AGENT_ONLY_MEDIA === '1'`. Côté client, le flag est déjà exposé par `useServerless()` (`components/serverless-provider.tsx`).
- **Constante de vivacité :** `AGENT_LIVENESS_MS = 120_000` (`lib/db/agent-liveness.ts`). Ne pas la redéfinir.
- **Le chemin self-hosted ne doit pas changer de comportement.** Toute modification est conditionnée au mode serverless.
- **Commits :** Conventional Commits (`feat(area):`, `fix(area):`, `test(area):`, `docs(area):`).
- ⚠️ **Le hook rtk pousse vers `origin` à chaque `git commit`.** C'est attendu, la branche n'est pas `main`.

## File Structure

| Fichier | Responsabilité |
| --- | --- |
| `lib/sse/seed-state.ts` *(créé)* | Type `SeedState` et fonction pure `seedToStream()`. **Aucun import serveur** — ce module est importé par un composant client. |
| `lib/sse/build-seed-state.ts` *(créé)* | Construction serveur de `SeedState` depuis la base. Importe `db`, `getNowPlaying`, `getAgentLastSeen`. Jamais importé par du code client. |
| `app/recalbox-events-provider.tsx` *(modifié)* | Ajoute les props `live` et `initialState` ; court-circuite l'`EventSource` et le fallback 10 s. |
| `app/[locale]/layout.tsx` *(modifié)* | Calcule `initialState` en RSC, avec la garde d'autorisation. |
| `app/api/events/route.ts` *(modifié)* | `204` en serverless ; nettoyage du backoff idle devenu mort. |
| `app/[locale]/page.tsx` *(modifié)* | Retire les panneaux système en serverless, monte `RefreshLiveState`. |
| `components/refresh-live-state.tsx` *(créé)* | Bouton `router.refresh()` et horodatage du dernier signal. |
| `components/notification-bell.tsx` *(modifié)* | Supprime l'intervalle en serverless. |
| `app/api/agent/snapshots/route.ts` *(modifié)* | No-op en serverless. |
| `agent/agent.py` *(modifié)* | Défaut `snapshot_interval_sec: 0` et garde avant le thread. |
| `agent/config.example.json` *(modifié)* | `snapshot_interval_sec` à `0`. |

Le découpage `seed-state.ts` / `build-seed-state.ts` n'est pas cosmétique : `seed-state.ts` est importé par un composant `'use client'`, donc il ne doit **jamais** tirer `@/lib/db` dans le bundle navigateur.

---

## Task 1 : Module pur d'amorçage

**Files:**
- Create: `apps/dashboard/lib/sse/seed-state.ts`
- Test: `apps/dashboard/lib/sse/__tests__/seed-state.test.ts`

**Interfaces:**
- Consumes: `GameStartEvent` depuis `@/lib/recalbox/events`.
- Produces: `type SeedState`, `function seedToStream(seed: SeedState | null): StreamState`, `type StreamState`, `type ActivityState`, `const initialActivity`, `const initialStream`. Les tâches 2, 3 et 4 en dépendent.

**Contexte :** `ActivityState`, `StreamState`, `initialActivity` et `initialStream` vivent aujourd'hui dans `app/recalbox-events-provider.tsx`. On les déplace ici pour qu'ils soient testables sans DOM, et le provider les ré-exportera (Task 3) afin de ne casser aucun import existant.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/dashboard/lib/sse/__tests__/seed-state.test.ts` :

```ts
import type { GameStartEvent } from '@/lib/recalbox/events'
import { describe, expect, it } from 'vitest'
import { type SeedState, initialStream, seedToStream } from '../seed-state'

const game: GameStartEvent = {
	type: 'game:start',
	system: 'snes',
	systemFullName: 'Super Nintendo',
	gameName: 'Chrono Trigger',
	romPath: '/roms/snes/ct.zip',
	startedAt: new Date('2026-08-05T10:00:00Z'),
}

describe('seedToStream', () => {
	it('retourne l’état vide quand il n’y a pas de seed', () => {
		expect(seedToStream(null)).toEqual(initialStream)
	})

	it('reporte la box, le jeu et l’état en ligne', () => {
		const seed: SeedState = {
			box: 'rb-1',
			game,
			online: true,
			lastSeenAt: new Date('2026-08-05T10:01:00Z'),
		}
		const stream = seedToStream(seed)
		expect(stream.box).toBe('rb-1')
		expect(stream.mqttOnline).toBe(true)
		expect(stream.activity.game).toEqual(game)
	})

	it('laisse null les signaux absents en serverless', () => {
		const seed: SeedState = { box: 'rb-1', game: null, online: false, lastSeenAt: null }
		const stream = seedToStream(seed)
		expect(stream.activity.game).toBeNull()
		expect(stream.activity.browsing).toBeNull()
		expect(stream.activity.lastSystemInfo).toBeNull()
		expect(stream.activity.screensaver).toBe(false)
		expect(stream.mqttOnline).toBe(false)
	})

	it('mqttOnline vaut false — jamais null — dès qu’un seed existe', () => {
		// null signifie « en cours de chargement » côté UI et laisse les composants
		// en squelette perpétuel. Un seed est une réponse, pas une attente.
		const seed: SeedState = { box: 'rb-1', game: null, online: false, lastSeenAt: null }
		expect(seedToStream(seed).mqttOnline).not.toBeNull()
	})
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/dashboard && pnpm exec vitest run lib/sse/__tests__/seed-state.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "../seed-state"`.

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/dashboard/lib/sse/seed-state.ts` :

```ts
import type { GameStartEvent, SystemChangeEvent, SystemInfoEvent } from '@/lib/recalbox/events'

export type ActivityState = {
	game: GameStartEvent | null
	screensaver: boolean
	browsing: SystemChangeEvent | null
	lastSystemInfo: SystemInfoEvent | null
}

/** Live state plus the box it describes, so staleness is derivable rather than reset. */
export type StreamState = { box: string | null; activity: ActivityState; mqttOnline: boolean | null }

export const initialActivity: ActivityState = {
	game: null,
	screensaver: false,
	browsing: null,
	lastSystemInfo: null,
}

export const initialStream: StreamState = {
	box: null,
	activity: initialActivity,
	mqttOnline: null,
}

/**
 * Serverless snapshot of what the SSE stream used to deliver. Computed server-side
 * once per render; there is no cloud→box MQTT to keep it fresh.
 */
export type SeedState = {
	box: string | null
	game: GameStartEvent | null
	online: boolean
	lastSeenAt: Date | null
}

/**
 * Fold a server-computed seed into the provider's state shape.
 *
 * `mqttOnline` is deliberately a boolean and never null: null means "still waiting"
 * to every consumer, which would leave them in a permanent loading skeleton. A seed
 * is an answer.
 *
 * Kept out of the provider module so it stays unit-testable without a DOM, and so
 * the provider file only exports components (Fast Refresh).
 */
export function seedToStream(seed: SeedState | null): StreamState {
	if (!seed) return initialStream
	return {
		box: seed.box,
		activity: { ...initialActivity, game: seed.game },
		mqttOnline: seed.online,
	}
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd apps/dashboard && pnpm exec vitest run lib/sse/__tests__/seed-state.test.ts
```

Attendu : 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/sse/seed-state.ts apps/dashboard/lib/sse/__tests__/seed-state.test.ts
git commit -m "feat(sse): pure seed-state module for serverless provider bootstrap"
```

---

## Task 2 : Construction serveur du seed

**Files:**
- Create: `apps/dashboard/lib/sse/build-seed-state.ts`
- Test: `apps/dashboard/lib/sse/__tests__/build-seed-state.test.ts`

**Interfaces:**
- Consumes: `SeedState` (Task 1) ; `getNowPlaying`, `nowPlayingToEvent` (`@/lib/db/now-playing`) ; `getAgentLastSeen`, `AGENT_LIVENESS_MS` (`@/lib/db/agent-liveness`) ; `type DB` (`@/lib/db`).
- Produces: `async function buildSeedState(db: DB, recalboxId: string | null): Promise<SeedState>`. La tâche 4 l'appelle.

**Contexte :** `nowPlayingToEvent(row)` retourne un `GameStartEvent` quand `row.playing` est vrai, sinon un `GameStopEvent`. Le seed ne garde que le premier cas — un `game:stop` signifie « rien en cours ». La garde d'autorisation n'est **pas** ici : elle vit dans le layout (Task 4), qui possède déjà `viewable`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/dashboard/lib/sse/__tests__/build-seed-state.test.ts` :

```ts
import path from 'node:path'
import type { DB } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import { upsertNowPlaying } from '@/lib/db/now-playing'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSeedState } from '../build-seed-state'

const MIGRATIONS_FOLDER = path.join(__dirname, '../../../drizzle/migrations')

function makeDb() {
	const sqlite = new Database(':memory:')
	sqlite.pragma('journal_mode = WAL')
	const db = drizzle(sqlite, { schema })
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
	return db as unknown as DB
}

const BOX = 'rb-1'

async function seedBox(db: DB) {
	await db.insert(schema.recalboxes).values({
		id: BOX,
		name: 'Salon',
		host: 'recalbox.local',
	})
}

/** Insert an agent token whose lastUsedAt drives the liveness signal. */
async function seedToken(db: DB, lastUsedAt: Date | null) {
	await db.insert(schema.agentTokens).values({
		recalboxId: BOX,
		tokenHash: 'deadbeef',
		label: 'test',
		lastUsedAt,
	})
}

let db: DB
beforeEach(async () => {
	db = makeDb()
	await seedBox(db)
})

describe('buildSeedState', () => {
	it('retourne un seed vide quand aucune box n’est active', async () => {
		expect(await buildSeedState(db, null)).toEqual({
			box: null,
			game: null,
			online: false,
			lastSeenAt: null,
		})
	})

	it('expose le jeu en cours', async () => {
		await upsertNowPlaying(db, BOX, {
			playing: true,
			system: 'snes',
			systemFullName: 'Super Nintendo',
			gameName: 'Chrono Trigger',
			romPath: '/roms/snes/ct.zip',
			startedAt: new Date('2026-08-05T10:00:00Z'),
		})
		const seed = await buildSeedState(db, BOX)
		expect(seed.box).toBe(BOX)
		expect(seed.game?.type).toBe('game:start')
		expect(seed.game?.gameName).toBe('Chrono Trigger')
	})

	it('n’expose aucun jeu quand la partie est terminée', async () => {
		await upsertNowPlaying(db, BOX, {
			playing: false,
			romPath: '/roms/snes/ct.zip',
			gameName: 'Chrono Trigger',
		})
		const seed = await buildSeedState(db, BOX)
		expect(seed.game).toBeNull()
	})

	it('est en ligne quand l’agent a été vu récemment', async () => {
		await seedToken(db, new Date())
		const seed = await buildSeedState(db, BOX)
		expect(seed.online).toBe(true)
		expect(seed.lastSeenAt).toBeInstanceOf(Date)
	})

	it('est hors ligne au-delà de la fenêtre de vivacité', async () => {
		await seedToken(db, new Date(Date.now() - 10 * 60 * 1000))
		const seed = await buildSeedState(db, BOX)
		expect(seed.online).toBe(false)
		// lastSeenAt reste renseigné : l'UI affiche « dernier signal il y a 10 min ».
		expect(seed.lastSeenAt).toBeInstanceOf(Date)
	})

	it('est hors ligne quand aucun agent n’a jamais été vu', async () => {
		const seed = await buildSeedState(db, BOX)
		expect(seed.online).toBe(false)
		expect(seed.lastSeenAt).toBeNull()
	})
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/dashboard && pnpm exec vitest run lib/sse/__tests__/build-seed-state.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "../build-seed-state"`.

> Si l'échec porte sur une colonne manquante de `recalboxes` ou `agentTokens`, ouvrir `lib/db/schema.ts` et compléter les objets `seedBox` / `seedToken` avec les colonnes `notNull` sans défaut. Ne pas modifier le schéma.

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `apps/dashboard/lib/sse/build-seed-state.ts` :

```ts
import type { DB } from '@/lib/db'
import { AGENT_LIVENESS_MS, getAgentLastSeen } from '@/lib/db/agent-liveness'
import { getNowPlaying, nowPlayingToEvent } from '@/lib/db/now-playing'
import type { SeedState } from '@/lib/sse/seed-state'

/**
 * Server-side snapshot of the live state, for serverless mode where no SSE stream
 * exists. One read of `now_playing` plus one of the agent-token liveness, per page
 * render — instead of a stream polling both every few seconds for the tab's lifetime.
 *
 * SERVER ONLY: pulls in `@/lib/db`. Never import this from a client component; the
 * client-safe half lives in `@/lib/sse/seed-state`.
 *
 * Callers MUST have checked that `recalboxId` is viewable by the current user.
 */
export async function buildSeedState(db: DB, recalboxId: string | null): Promise<SeedState> {
	const empty: SeedState = { box: null, game: null, online: false, lastSeenAt: null }
	if (!recalboxId) return empty

	const [row, lastSeen] = await Promise.all([
		getNowPlaying(db, recalboxId),
		getAgentLastSeen(db),
	])

	// nowPlayingToEvent returns a game:stop for a finished game — that is "nothing
	// running", not something to display.
	const event = row ? nowPlayingToEvent(row) : null
	const game = event?.type === 'game:start' ? event : null

	const seenAt = lastSeen.get(recalboxId) ?? null

	return {
		box: recalboxId,
		game,
		online: seenAt ? Date.now() - seenAt.getTime() < AGENT_LIVENESS_MS : false,
		lastSeenAt: seenAt,
	}
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd apps/dashboard && pnpm exec vitest run lib/sse/__tests__/build-seed-state.test.ts
```

Attendu : 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/sse/build-seed-state.ts apps/dashboard/lib/sse/__tests__/build-seed-state.test.ts
git commit -m "feat(sse): server-side seed builder for serverless live state"
```

---

## Task 3 : Le provider accepte `live` et `initialState`

**Files:**
- Modify: `apps/dashboard/app/recalbox-events-provider.tsx`

**Interfaces:**
- Consumes: `SeedState`, `StreamState`, `ActivityState`, `initialActivity`, `initialStream`, `seedToStream` (Task 1).
- Produces: `RecalboxEventsProvider` avec les props `{ children, recalboxId?, live?, initialState? }`. La tâche 4 les câble.

**Contexte :** aucun test de composant n'est possible (pas de DOM, cf. contraintes globales). La logique testable a été extraite en Task 1 ; cette tâche est du câblage, vérifié par le typecheck, le lint et la suite complète.

- [ ] **Step 1: Déplacer les types vers le module partagé**

Dans `app/recalbox-events-provider.tsx`, **supprimer** les déclarations locales de `ActivityState`, `StreamState`, `initialActivity` et `initialStream`, puis ajouter l'import et la ré-export :

```ts
import {
	type ActivityState,
	type SeedState,
	type StreamState,
	initialActivity,
	initialStream,
	seedToStream,
} from '@/lib/sse/seed-state'

export type { ActivityState, SeedState }
```

`ActivityState` était exporté depuis ce fichier ; la ré-export garde les imports existants valides.

- [ ] **Step 2: Ajouter les props et court-circuiter l'EventSource**

Remplacer la signature du composant et l'initialisation d'état :

```tsx
export function RecalboxEventsProvider({
	children,
	recalboxId = null,
	live = true,
	initialState = null,
}: {
	children: React.ReactNode
	recalboxId?: string | null
	/** False in serverless mode: no SSE stream is opened at all. */
	live?: boolean
	/** Server-computed state, used when `live` is false. */
	initialState?: SeedState | null
}) {
	const [stream, setStream] = useState<StreamState>(() => seedToStream(initialState))
```

Dans l'effet du fallback 10 s, sortir immédiatement quand le flux est désactivé :

```tsx
	useEffect(() => {
		// Not live: `initialState` already carries a definitive online value. Letting
		// the fallback run would flip a correctly-seeded state to offline after 10s.
		if (!live) return
		const fallback = setTimeout(() => {
			setStream((prev) => (prev.mqttOnline === null ? { ...prev, mqttOnline: false } : prev))
		}, 10_000)
		return () => clearTimeout(fallback)
	}, [live])
```

Dans l'effet qui ouvre l'`EventSource`, sortir avant `connect()` :

```tsx
	useEffect(() => {
		// Serverless: no stream at all. Each open SSE connection re-ran DB polls for
		// its whole lifetime — tens of thousands of Turso reads per idle tab per day,
		// and a function held warm continuously (Fluid Active CPU). The state is
		// seeded server-side instead and refreshed by router.refresh().
		if (!live) return

		let reconnectTimer: ReturnType<typeof setTimeout>
		let attempt = 0
		// … corps existant inchangé …
	}, [recalboxId, live])
```

⚠️ Ajouter `live` au tableau de dépendances des **deux** effets.

- [ ] **Step 3: Vérifier le typecheck et le lint**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
cd ../.. && pnpm lint
```

Attendu : aucune erreur. Une erreur sur `ActivityState` ailleurs signale une ré-export oubliée à l'étape 1.

- [ ] **Step 4: Lancer la suite complète (non-régression)**

```bash
cd apps/dashboard && pnpm exec vitest run
```

Attendu : tous les tests passent, y compris `app/api/events/__tests__/route.test.ts` (la route n'a pas encore changé).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/recalbox-events-provider.tsx
git commit -m "feat(sse): let RecalboxEventsProvider run seeded without a stream"
```

---

## Task 4 : Câblage du layout

**Files:**
- Modify: `apps/dashboard/app/[locale]/layout.tsx`

**Interfaces:**
- Consumes: `buildSeedState` (Task 2) ; props `live` / `initialState` (Task 3).
- Produces: rien de nouveau pour les tâches suivantes.

**Contexte :** le layout calcule déjà `serverless`, `viewable` et `activeRecalboxId`. La garde d'autorisation est indispensable : `buildSeedState` ne vérifie rien, et sans le test un utilisateur pourrait recevoir l'état live de la box d'un autre — exactement la fuite que la route SSE ferme avec `getViewableRecalboxIds`.

- [ ] **Step 1: Calculer le seed**

Après la ligne `const serverless = isServerlessMode()`, ajouter :

```tsx
	// Serverless: no SSE stream, so the live state is read once here and handed to the
	// provider. The viewable check is the security boundary — buildSeedState trusts its
	// caller, and an unchecked id would leak another user's box state.
	const seed =
		serverless && activeRecalboxId && viewable.has(activeRecalboxId)
			? await buildSeedState(db, activeRecalboxId)
			: null
```

Ajouter les imports en tête de fichier :

```tsx
import { db } from '@/lib/db'
import { buildSeedState } from '@/lib/sse/build-seed-state'
```

- [ ] **Step 2: Passer les props au provider**

```tsx
<RecalboxEventsProvider
	recalboxId={activeRecalboxId}
	live={!serverless}
	initialState={seed}
>
```

- [ ] **Step 3: Vérifier le typecheck et le lint**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
cd ../.. && pnpm lint
```

Attendu : aucune erreur. `Date` traverse la frontière RSC → client sans conversion, `lastSeenAt` n'a pas besoin d'être sérialisé en chaîne.

- [ ] **Step 4: Vérifier le rendu en self-hosted**

```bash
cd apps/dashboard && pnpm build
```

Attendu : build réussi. Sans `AGENT_ONLY_MEDIA=1`, `serverless` est faux, `seed` vaut `null`, `live` vaut `true` : comportement actuel intact.

- [ ] **Step 5: Commit**

```bash
git add "apps/dashboard/app/[locale]/layout.tsx"
git commit -m "feat(serverless): seed the events provider server-side in the layout"
```

---

## Task 5 : `/api/events` répond 204 en serverless

**Files:**
- Modify: `apps/dashboard/app/api/events/route.ts`
- Modify: `apps/dashboard/app/api/events/__tests__/route.test.ts`
- Test: `apps/dashboard/app/api/events/__tests__/serverless-disabled.test.ts` *(créé)*

**Interfaces:**
- Consumes: `isServerlessMode` (`@/lib/serverless`).
- Produces: rien pour les tâches suivantes.

**⚠️ Complication centrale de cette tâche.** `route.test.ts` mocke aujourd'hui `isServerlessMode: () => true` (ligne 24) et vérifie tout le chemin de polling : relais now-playing, vivacité, cloisonnement ACL, notifications. Un `204` en serverless viderait **toute** cette suite de son sens. Ces tests couvrent une régression de sécurité réelle et ne doivent pas être perdus : on bascule le fichier en self-hosted, où les mêmes boucles tournent toujours pour les box dont MQTT est déconnecté.

Cela impose de corriger le mock MQTT. Le mock actuel, `mqttPool: { getClient: () => null }`, ne fonctionne qu'en serverless où la boucle est sautée. En self-hosted la route fait `client.on(...)` et `client.isConnected` sur la valeur retournée — `null` déclencherait un `TypeError`. La route ne rattrape qu'un *throw* de `getClient`, pas un retour `null`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/dashboard/app/api/events/__tests__/serverless-disabled.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/serverless', () => ({ isServerlessMode: () => true }))

import { GET } from '../route'

describe('GET /api/events en mode serverless', () => {
	it('répond 204 sans ouvrir de flux', async () => {
		const res = await GET(new Request('http://x/api/events'))
		expect(res.status).toBe(204)
		expect(res.body).toBeNull()
	})

	// Le court-circuit doit précéder l'authentification et toute lecture DB : le but
	// est justement de ne rien coûter. Un bundle client périmé qui rappelle cette
	// route ne doit déclencher aucune requête Turso.
	it('ne touche ni à l’auth ni à la base', async () => {
		const res = await GET(new Request('http://x/api/events?recalboxId=nimporte'))
		expect(res.status).toBe(204)
	})
})
```

Aucun autre mock n'est déclaré : si la route atteignait `getUser()`, l'import réel de `@/lib/auth/require-user` ferait échouer le test. C'est délibéré — c'est ce qui prouve le court-circuit.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/dashboard && pnpm exec vitest run app/api/events/__tests__/serverless-disabled.test.ts
```

Attendu : ÉCHEC — statut 401/500 au lieu de 204, ou erreur d'import sur les modules d'auth non mockés.

- [ ] **Step 3: Écrire l'implémentation minimale**

Dans `app/api/events/route.ts`, en toute première instruction de `GET` :

```ts
export async function GET(request: Request) {
	// Serverless: no SSE at all. The live state is seeded server-side (see
	// lib/sse/build-seed-state.ts) and refreshed on demand. Returning before auth and
	// before any DB read is the point — a stale client bundle that still opens this
	// must cost nothing. EventSource sees a non-event-stream response, gives up, and
	// lands on the long `refused` backoff in lib/sse/reconnect-delay.ts.
	if (isServerlessMode()) return new Response(null, { status: 204 })

	const user = await getUser()
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd apps/dashboard && pnpm exec vitest run app/api/events/__tests__/serverless-disabled.test.ts
```

Attendu : 2 tests PASS.

- [ ] **Step 5: Basculer la suite existante en self-hosted**

Dans `app/api/events/__tests__/route.test.ts`, remplacer le mock serverless :

```ts
// Self-hosted: MQTT clients exist but are disconnected here, so the DB polls still
// drive the stream — the same code paths the serverless mode used to exercise.
vi.mock('@/lib/serverless', () => ({ isServerlessMode: () => false }))
```

Et remplacer le mock MQTT par un faux client complet — `getClient` retournait `null`, ce qui ne passait que parce que la boucle était sautée :

```ts
vi.mock('@/lib/recalbox/mqtt-client', () => ({
	mqttPool: {
		// A disconnected client: the route then falls through to the DB polls, which is
		// exactly what these tests assert on.
		getClient: () => ({
			isConnected: false,
			lastKnownGame: null,
			lastKnownScreensaverGame: null,
			isScreensaverActive: false,
			lastKnownBrowsing: null,
			on: () => {},
			off: () => {},
		}),
	},
}))
```

- [ ] **Step 6: Vérifier que la suite existante passe toujours**

```bash
cd apps/dashboard && pnpm exec vitest run app/api/events/__tests__/route.test.ts
```

Attendu : tous les tests passent, inchangés dans leurs assertions. Ils couvrent toujours le cloisonnement ACL et la portée des notifications.

- [ ] **Step 7: Retirer le backoff idle devenu mort**

`idle()` s'écrit `isServerlessMode() && …` : la route ne s'exécute désormais plus jamais en serverless, donc il vaut toujours `false`. Supprimer le code mort — les constantes `IDLE_NOW_PLAYING_MS` et `IDLE_SLOW_POLL_MS`, les helpers `anyGameActive`, `anyBoxOnline` et `idle`, l'import `isServerlessMode` s'il n'est plus utilisé ailleurs dans le fichier — et simplifier les deux boucles :

```ts
		nowPlayingTimer = setTimeout(loopNowPlaying, NOW_PLAYING_POLL_MS)
```

```ts
		slowTimer = setTimeout(loopSlow, SLOW_POLL_MS)
```

⚠️ L'import `isServerlessMode` sert **aussi** au court-circuit de l'étape 3 : le conserver.

Mettre à jour le commentaire du bloc de constantes, qui parle d'un coût Turso désormais sans objet :

```ts
// Each open SSE stream re-runs these DB polls for its whole lifetime, so every tab is
// steady read load. Self-hosted only — serverless returns 204 above and seeds its state
// server-side instead. A few seconds of lag on a status pill is invisible; the
// slow-moving signals (connection, CPU/temp) poll least often.
```

- [ ] **Step 8: Lancer la suite complète et le lint**

```bash
cd apps/dashboard && pnpm exec vitest run
cd ../.. && pnpm lint
```

Attendu : tout passe.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/app/api/events/
git commit -m "feat(serverless): return 204 from /api/events and drop the dead idle backoff"
```

---

## Task 6 : Page dashboard — panneaux retirés, bouton Rafraîchir

**Files:**
- Create: `apps/dashboard/components/refresh-live-state.tsx`
- Delete: `apps/dashboard/components/serverless-system-panel.tsx`
- Modify: `apps/dashboard/app/[locale]/page.tsx`
- Modify: `apps/dashboard/messages/en.json`
- Modify: `apps/dashboard/messages/fr.json`

**Interfaces:**
- Consumes: `isServerlessMode` (`@/lib/serverless`).
- Produces: `RefreshLiveState` avec la prop `{ lastSeenAt: Date | null }`.

**Contexte :** `SystemStatsChart` et `MonitoringPanel` ne sont plus montés en serverless — ils dupliquaient la page monitoring du Web Manager Recalbox. Ces deux fichiers **restent en place**, le self-hosted les utilise toujours.

`ServerlessSystemPanel` fait exception : il n'existait que pour le mode serverless, où il était nourri par les snapshots de l'agent qu'on supprime. Il devient du code mort et son fichier est supprimé. `page.tsx` est son unique consommateur.

`page.tsx` branche déjà sur `isServerlessMode()`, on suit ce motif.

- [ ] **Step 1: Ajouter les clés i18n**

Dans `messages/en.json`, sous `dashboard`, à côté de `nowPlaying` :

```json
		"live": {
			"refresh": "Refresh",
			"lastSignal": "Last signal {time}",
			"never": "No signal received yet"
		},
```

Dans `messages/fr.json`, au même endroit :

```json
		"live": {
			"refresh": "Rafraîchir",
			"lastSignal": "Dernier signal {time}",
			"never": "Aucun signal reçu"
		},
```

- [ ] **Step 2: Créer le composant**

Créer `apps/dashboard/components/refresh-live-state.tsx` :

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

/**
 * Serverless replacement for the SSE stream: the live state is rendered server-side
 * once, and the user decides when to pay for another read. router.refresh() re-runs
 * the RSC layout, which rebuilds the seed and re-renders the provider.
 */
export function RefreshLiveState({ lastSeenAt }: { lastSeenAt: Date | null }) {
	const t = useTranslations('dashboard.live')
	const format = useFormatter()
	const router = useRouter()
	const [pending, startTransition] = useTransition()

	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground">
			<span>
				{lastSeenAt ? t('lastSignal', { time: format.relativeTime(lastSeenAt) }) : t('never')}
			</span>
			<Button
				variant="ghost"
				size="sm"
				disabled={pending}
				onClick={() => startTransition(() => router.refresh())}
			>
				<RefreshCw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} />
				{t('refresh')}
			</Button>
		</div>
	)
}
```

- [ ] **Step 3: Câbler la page**

Dans `app/[locale]/page.tsx`, ajouter les imports :

```tsx
import { RefreshLiveState } from '@/components/refresh-live-state'
import { db } from '@/lib/db'
import { getAgentLastSeen } from '@/lib/db/agent-liveness'
import { getActiveRecalboxId } from '@/lib/recalbox/active'
```

Dans le corps du composant, après `const t = await getTranslations('dashboard')` :

```tsx
	const serverless = isServerlessMode()
	// Only the last-signal timestamp is needed here — the game state already reaches
	// the UI through the provider, seeded by the layout. One query, not a second seed.
	const activeRecalboxId = serverless ? await getActiveRecalboxId() : null
	const lastSeenAt = activeRecalboxId
		? ((await getAgentLastSeen(db)).get(activeRecalboxId) ?? null)
		: null
```

Remplacer la seconde `<section>` par :

```tsx
				<section className="space-y-4">
					<SectionLabel>{t('system.title')}</SectionLabel>
					{serverless ? (
						<RefreshLiveState lastSeenAt={lastSeenAt} />
					) : (
						<>
							<Suspense
								fallback={
									<div className="animate-pulse text-sm text-muted-foreground">
										{t('system.loading')}
									</div>
								}
							>
								<SystemStatsChart />
							</Suspense>
							<MonitoringPanel />
						</>
					)}
				</section>
```

Retirer l'import désormais inutilisé de `ServerlessSystemPanel`, puis supprimer son fichier :

```bash
git rm apps/dashboard/components/serverless-system-panel.tsx
```

Vérifier au préalable qu'il n'a pas d'autre consommateur :

```bash
cd /home/madjid/projets/recalbox-dashboard && grep -rn "ServerlessSystemPanel" apps/dashboard --include=*.tsx --include=*.ts
```

Attendu : aucun résultat une fois `page.tsx` modifié.

> `buildSeedState` est appelé une seconde fois ici (le layout l'appelle déjà). C'est une lecture de plus par rendu de page, sans commune mesure avec le stream qu'on supprime, et cela évite de faire transiter le seed du layout vers la page. Ne pas chercher à partager l'appel.

- [ ] **Step 4: Vérifier le typecheck, le lint et le build**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit && pnpm build
cd ../.. && pnpm lint
```

Attendu : aucune erreur. Une erreur sur `ServerlessSystemPanel` signale un import laissé en place.

- [ ] **Step 5: Vérifier les deux fichiers de traduction**

```bash
cd apps/dashboard && python3 -c "
import json
en = json.load(open('messages/en.json'))['dashboard']['live']
fr = json.load(open('messages/fr.json'))['dashboard']['live']
assert en.keys() == fr.keys(), (en.keys(), fr.keys())
print('clés alignées:', sorted(en))
"
```

Attendu : `clés alignées: ['lastSignal', 'never', 'refresh']`.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/components/refresh-live-state.tsx "apps/dashboard/app/[locale]/page.tsx" apps/dashboard/messages/ apps/dashboard/components/serverless-system-panel.tsx
git commit -m "feat(serverless): replace the system panels with a server-rendered refresh control"
```

---

## Task 7 : La cloche perd son intervalle en serverless

**Files:**
- Modify: `apps/dashboard/components/notification-bell.tsx`

**Interfaces:**
- Consumes: `useServerless` (`@/components/serverless-provider`).
- Produces: rien pour les tâches suivantes.

**Contexte :** `setInterval(fetchNotifications, 30000)` tourne indépendamment du SSE — environ 2 880 invocations de fonction par onglet et par jour. En serverless, le Web Push assure déjà la remontée immédiate ; l'intervalle ne sert plus qu'à rafraîchir un badge. `Popover` vient de `@base-ui/react` et accepte `onOpenChange` via `PopoverPrimitive.Root.Props`.

- [ ] **Step 1: Conditionner l'intervalle**

Ajouter l'import :

```tsx
import { useServerless } from '@/components/serverless-provider'
```

Dans le composant, ajouter `const serverless = useServerless()` puis remplacer l'effet de polling :

```tsx
	useEffect(() => {
		fetchNotifications()
		// Serverless: no background interval. Web Push already delivers notifications
		// immediately; a 30s poll only refreshes a badge, at ~2880 function invocations
		// per open tab per day. The popover refetches on open instead.
		if (serverless) return
		pollTimer.current = setInterval(fetchNotifications, 30000)
		return () => {
			if (pollTimer.current) clearInterval(pollTimer.current)
		}
	}, [fetchNotifications, serverless])
```

- [ ] **Step 2: Rafraîchir à l'ouverture du popover**

```tsx
		<Popover
			onOpenChange={(open) => {
				if (open) fetchNotifications()
			}}
		>
```

- [ ] **Step 3: Vérifier le typecheck et le lint**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
cd ../.. && pnpm lint
```

Attendu : aucune erreur. Si `onOpenChange` est refusé, vérifier la signature exacte dans `components/ui/popover.tsx` — le wrapper transmet `PopoverPrimitive.Root.Props` tel quel.

- [ ] **Step 4: Lancer la suite complète**

```bash
cd apps/dashboard && pnpm exec vitest run
```

Attendu : tout passe.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/components/notification-bell.tsx
git commit -m "perf(notifications): drop the 30s bell poll in serverless mode"
```

---

## Task 8 : `/api/agent/snapshots` devient un no-op en serverless

**Files:**
- Modify: `apps/dashboard/app/api/agent/snapshots/route.ts`
- Test: `apps/dashboard/app/api/agent/__tests__/snapshots-noop.test.ts` *(créé)*

**Interfaces:**
- Consumes: `isServerlessMode` (`@/lib/serverless`).
- Produces: rien pour les tâches suivantes.

**Contexte :** c'est le levier robuste. `load_config()` fusionne `config.json` par-dessus les défauts : les box déjà enrôlées portent une valeur explicite qui écrase le nouveau défaut de la Task 9, et continueraient donc de pousser. Couper côté serveur ramène les écritures Turso à zéro immédiatement, sans toucher à aucune box.

Le token reste validé avant le no-op : `resolveAgentToken` met à jour `lastUsedAt`, qui est le **signal de vivacité** lu par `buildSeedState`. Court-circuiter avant l'authentification ferait passer toutes les box hors ligne.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/dashboard/app/api/agent/__tests__/snapshots-noop.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const ingestSnapshot = vi.fn()

vi.mock('@/lib/serverless', () => ({ isServerlessMode: () => true }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/agent/ingest-snapshot', () => ({
	ingestSnapshot: (...a: unknown[]) => ingestSnapshot(...a),
}))

import { POST } from '../snapshots/route'

const body = {
	captured_at: new Date().toISOString(),
	cpu_percent: 12,
	mem_used_mb: 300,
	mem_total_mb: 1000,
	temp_celsius: 45,
	uptime_seconds: 3600,
}

const post = () =>
	POST(
		new Request('http://x/api/agent/snapshots', {
			method: 'POST',
			headers: { authorization: 'Bearer t0ken', 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}) as never,
	)

describe('POST /api/agent/snapshots en mode serverless', () => {
	it('accepte la requête sans rien écrire', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb-1' })
		const res = await post()
		expect(res.status).toBe(204)
		expect(ingestSnapshot).not.toHaveBeenCalled()
	})

	// lastUsedAt est le signal de vivacité lu par buildSeedState : le token doit être
	// résolu même si la charge utile est jetée, sinon toutes les box passent hors ligne.
	it('résout quand même le token', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb-1' })
		await post()
		expect(resolveAgentToken).toHaveBeenCalled()
	})

	it('refuse toujours un token invalide', async () => {
		resolveAgentToken.mockResolvedValue(null)
		const res = await post()
		expect(res.status).toBe(401)
	})
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd apps/dashboard && pnpm exec vitest run app/api/agent/__tests__/snapshots-noop.test.ts
```

Attendu : ÉCHEC — statut 201 au lieu de 204, et `ingestSnapshot` appelé.

- [ ] **Step 3: Écrire l'implémentation minimale**

Dans `app/api/agent/snapshots/route.ts`, ajouter l'import :

```ts
import { isServerlessMode } from '@/lib/serverless'
```

Puis, juste après la résolution du token et **avant** la lecture du corps :

```ts
	const resolved = await resolveAgentToken(db, token)
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	// Serverless: system snapshots no longer have a reader — the panel they fed
	// duplicated the Recalbox Web Manager and has been removed. Accept and discard,
	// so already-enrolled boxes stop costing Turso writes without needing a config
	// update. The token was resolved above on purpose: it refreshes lastUsedAt, which
	// is the liveness signal driving connection status.
	if (isServerlessMode()) return new Response(null, { status: 204 })

	let json: unknown
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd apps/dashboard && pnpm exec vitest run app/api/agent/__tests__/snapshots-noop.test.ts
```

Attendu : 3 tests PASS.

- [ ] **Step 5: Lancer la suite complète et le lint**

```bash
cd apps/dashboard && pnpm exec vitest run
cd ../.. && pnpm lint
```

Attendu : tout passe. `lib/agent/__tests__/ingest-snapshot.test.ts` teste la fonction directement, sans passer par la route : il reste vert.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/app/api/agent/
git commit -m "perf(agent): discard system snapshots server-side in serverless mode"
```

---

## Task 9 : L'agent cesse de pousser les snapshots

**Files:**
- Modify: `agent/agent.py`
- Modify: `agent/config.example.json`
- Test: `agent/test_agent_snapshots.py` *(créé)*

**Interfaces:**
- Consumes: rien des tâches précédentes.
- Produces: rien pour les tâches suivantes.

**Contexte — bug préexistant.** `agent/README.md` documente déjà « `snapshot_interval_sec` | 60 | system snapshots; `0` disables », mais aucune garde `<= 0` n'existe : le thread `snapshot_loop` démarre inconditionnellement, à la différence de `collection_loop` et `artwork_loop` qui sont tous deux gardés. On implémente le comportement documenté. Le README n'a donc pas besoin d'être modifié, seul le défaut change — mettre à jour la colonne « Default » de sa ligne, qui passe de `60` à `0`.

Le fichier de test est nouveau : `test_agent.py` couvre la politique de retry du buffer et ne doit pas être alourdi.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `agent/test_agent_snapshots.py` :

```python
#!/usr/bin/env python3
"""Tests for the snapshot loop's disable switch.

Stdlib unittest only: the agent is deliberately dependency-free. From the repo root:

    python3 -m unittest discover -s agent -v
"""

import sys
import types
import unittest
from unittest import mock

# agent.py imports paho at module level. It ships with RecalboxOS but is not needed
# to exercise the config logic, so stub it to keep the import cheap.
if "paho" not in sys.modules:
	_paho = types.ModuleType("paho")
	_mqtt = types.ModuleType("paho.mqtt")
	_client = types.ModuleType("paho.mqtt.client")
	_client.Client = object
	_paho.mqtt = _mqtt
	_mqtt.client = _client
	sys.modules["paho"] = _paho
	sys.modules["paho.mqtt"] = _mqtt
	sys.modules["paho.mqtt.client"] = _client

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import agent  # noqa: E402


class SnapshotLoopDisabled(unittest.TestCase):
	def test_returns_immediately_when_interval_is_zero(self):
		"""A zero interval must not enter the infinite loop, and must push nothing."""
		cfg = {"cloud_url": "https://x/api/agent/ingest", "snapshot_interval_sec": 0}
		# If the guard is missing this blocks forever inside `while True`.
		with mock.patch.object(agent, "http_post_json") as post:
			agent.snapshot_loop(cfg)
		post.assert_not_called()

	def test_returns_immediately_when_interval_is_negative(self):
		cfg = {"cloud_url": "https://x/api/agent/ingest", "snapshot_interval_sec": -1}
		with mock.patch.object(agent, "http_post_json") as post:
			agent.snapshot_loop(cfg)
		post.assert_not_called()

	def test_default_config_disables_snapshots(self):
		"""Serverless no longer reads snapshots, so the shipped default is off."""
		self.assertEqual(agent.load_config()["snapshot_interval_sec"], 0)


if __name__ == "__main__":
	unittest.main()
```

⚠️ Ces tests bloqueraient indéfiniment si la garde manquait. C'est voulu : lancer avec un timeout à l'étape suivante.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd /home/madjid/projets/recalbox-dashboard && timeout 20 python3 -m unittest agent.test_agent_snapshots -v
```

Attendu : ÉCHEC. `test_default_config_disables_snapshots` échoue avec `60 != 0`, et les deux autres sont tués par le timeout (code de sortie 124) faute de garde.

- [ ] **Step 3: Écrire l'implémentation minimale**

Dans `agent/agent.py`, changer le défaut (~ligne 90) :

```python
        "snapshot_interval_sec": 0,
```

Ajouter la garde en tête de `snapshot_loop` (~ligne 558), en calquant `collection_loop` :

```python
def snapshot_loop(cfg):
    """Periodically gather + push a system snapshot. Best-effort (no buffering)."""
    interval = _int_cfg(cfg, "snapshot_interval_sec", 0)
    if interval <= 0:
        log.info("System snapshots disabled (snapshot_interval_sec<=0)")
        return
    url = endpoint_for(cfg, "snapshots")
    token = cfg.get("token")
    timeout = cfg.get("http_timeout_sec", 10)
    delay = interval
    while True:
```

⚠️ `interval` doit être calculé **avant** `endpoint_for(cfg, "snapshots")` : construire l'URL pour une boucle qu'on n'exécute pas est du travail inutile, et `endpoint_for` peut lever si `cloud_url` est mal formé.

Le repli de `_int_cfg` passe de `300` à `0` : désactivé par défaut, y compris si la clé est absente.

Ne pas démarrer le thread inutilement (~ligne 1085) :

```python
    if int(cfg.get("snapshot_interval_sec", 0)) > 0:
        threading.Thread(target=snapshot_loop, args=(cfg,), daemon=True).start()
        log.info("System snapshots every %ss", cfg.get("snapshot_interval_sec"))
    else:
        log.info("System snapshots disabled")
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd /home/madjid/projets/recalbox-dashboard && timeout 20 python3 -m unittest agent.test_agent_snapshots -v
```

Attendu : 3 tests PASS, sans atteindre le timeout.

- [ ] **Step 5: Mettre à jour la configuration d'exemple et la documentation**

Dans `agent/config.example.json` :

```json
	"snapshot_interval_sec": 0,
```

Dans `agent/README.md`, la colonne « Default » de la ligne `snapshot_interval_sec` passe de `60` à `0`. Remplacer la ligne par :

```markdown
| `snapshot_interval_sec` | 0 | system snapshots; `0` disables (default: the cloud discards them) |
```

- [ ] **Step 6: Lancer toute la suite Python**

```bash
cd /home/madjid/projets/recalbox-dashboard && timeout 120 python3 -m unittest discover -s agent -v
```

Attendu : toute la suite passe, y compris `test_agent.py`, `test_agent_scan.py` et `test_scan_roms.py`.

- [ ] **Step 7: Commit**

```bash
git add agent/agent.py agent/config.example.json agent/README.md agent/test_agent_snapshots.py
git commit -m "feat(agent): disable system snapshots by default and honour the documented 0 switch"
```

---

## Vérification finale

- [ ] **Toute la suite TypeScript**

```bash
cd apps/dashboard && pnpm exec vitest run
```

- [ ] **Toute la suite Python**

```bash
cd /home/madjid/projets/recalbox-dashboard && timeout 120 python3 -m unittest discover -s agent -v
```

- [ ] **Lint et build**

```bash
cd /home/madjid/projets/recalbox-dashboard && pnpm lint
cd apps/dashboard && pnpm build
```

- [ ] **Non-régression self-hosted, manuelle**

```bash
cd /home/madjid/projets/recalbox-dashboard && pnpm dev
```

Sans `AGENT_ONLY_MEDIA=1`, ouvrir les outils réseau du navigateur et confirmer :
- `/api/events` est ouvert et reste en `pending` (le flux vit),
- le now-playing et le graphe de température se mettent à jour seuls,
- le panneau `MonitoringPanel` s'affiche.

- [ ] **Comportement serverless, manuel**

```bash
cd apps/dashboard && AGENT_ONLY_MEDIA=1 pnpm dev
```

Confirmer :
- `/api/events` répond `204` et n'est **pas** rappelé en boucle,
- aucune requête `/api/notifications` récurrente au repos,
- le now-playing s'affiche selon le contenu de `now_playing`,
- le bouton Rafraîchir met à jour l'horodatage,
- aucun panneau CPU/température n'est monté.
