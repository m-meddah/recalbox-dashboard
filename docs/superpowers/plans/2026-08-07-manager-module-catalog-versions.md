# Module Manager, catalogue étendu et versions — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regrouper les appels au Web Manager de la Recalbox dans un module unique, puis exploiter deux gisements de données déjà exposés par la box mais jamais lus — les propriétés des systèmes et les numéros de version.

**Architecture:** Un `client.ts` centralise le transport HTTP vers `http://{host}:81/api` avec un contrat unique (lecture best-effort qui renvoie `null`, écriture stricte qui lève). Les modules par domaine (`config`, `catalog`, `bios`, `versions`) ne portent plus que du parsing. Les pages consommatrices restent server-rendered et dégradent proprement quand la box est injoignable.

**Tech Stack:** TypeScript, Next.js 16 App Router, Vitest, Biome, next-intl.

## Global Constraints

- Code style Biome : **tabulations** pour l'indentation, **guillemets simples**, **pas de point-virgule**, virgules finales. Ne jamais reformater à la main : `pnpm lint` et `pnpm format` font foi.
- Les tests vivent dans un sous-dossier `__tests__/` à côté du code testé.
- L'alias `@` résout vers `apps/dashboard/`.
- Commande de test unitaire : `cd apps/dashboard && pnpm exec vitest run <chemin>`. Il n'existe **pas** de script `vitest` dans le `package.json` — toujours passer par `pnpm exec`.
- Port par défaut du Web Manager : **81**. Timeout de lecture **6000 ms**, d'écriture **8000 ms**.
- Une box injoignable ne doit **jamais** faire échouer le rendu d'une page. Les lectures renvoient une valeur vide et l'UI affiche un état « indisponible ».
- Ne **jamais** logger le corps d'une écriture de configuration : il transporte des clés Wi-Fi et des mots de passe.
- Messages de commit au format Conventional Commits : `feat(area): …`, `refactor(area): …`, `test(area): …`.
- Toute chaîne visible par l'utilisateur passe par next-intl et doit être ajoutée **dans `messages/en.json` et `messages/fr.json`**.

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
| --- | --- |
| `apps/dashboard/lib/recalbox/manager/client.ts` | Transport HTTP unique : URL, timeouts, contrat lecture/écriture, log |
| `apps/dashboard/lib/recalbox/manager/config.ts` | Lecture/écriture des sections `recalbox.conf`, masquage des secrets, contrôle d'EmulationStation |
| `apps/dashboard/lib/recalbox/manager/catalog.ts` | Catalogue des systèmes et de leurs émulateurs |
| `apps/dashboard/lib/recalbox/manager/bios.ts` | Rapport BIOS |
| `apps/dashboard/lib/recalbox/manager/versions.ts` | Versions Recalbox / kernel / RetroArch / cores |
| `apps/dashboard/lib/recalbox/manager/__tests__/client.test.ts` | |
| `apps/dashboard/lib/recalbox/manager/__tests__/config.test.ts` | |
| `apps/dashboard/lib/recalbox/manager/__tests__/catalog.test.ts` | |
| `apps/dashboard/lib/recalbox/manager/__tests__/versions.test.ts` | |
| `apps/dashboard/components/system-properties.tsx` | Badges de propriétés d'un système (partagé grille + fiche) |
| `apps/dashboard/components/recalbox-version-card.tsx` | Carte de version d'une box |

**Supprimés**

| Fichier | Devient |
| --- | --- |
| `apps/dashboard/lib/recalbox/web-config.ts` | `manager/config.ts` + `manager/catalog.ts` |
| `apps/dashboard/lib/recalbox/bios.ts` | `manager/bios.ts` |
| `apps/dashboard/lib/recalbox/__tests__/web-config.test.ts` | `manager/__tests__/{config,catalog}.test.ts` |
| `apps/dashboard/lib/recalbox/__tests__/bios.test.ts` | `manager/__tests__/bios.test.ts` |

**Modifiés**

- `apps/dashboard/lib/recalbox/storage.ts` — bascule sur `managerRead`, **ne bouge pas de dossier** (son type `StorageMount` est importé par `lib/db/schema.ts`, `lib/recalbox/events.ts` et `lib/agent/ingest-snapshot.ts`, du code qui n'a rien à voir avec le port 81)
- `apps/dashboard/app/api/system/frontend/route.ts`, `apps/dashboard/app/api/recalbox/config/[section]/route.ts` (+ son test), `apps/dashboard/app/api/recalbox/systems/route.ts`, `apps/dashboard/app/api/bios/route.ts` — chemins d'import
- `apps/dashboard/components/config/config-section-form.tsx`, `components/config/systems-catalog.tsx`, `components/collection/emulator-override-button.tsx`, `components/bios-table.tsx` — chemins d'import
- `apps/dashboard/app/[locale]/configuration/systems/page.tsx` — chemin d'import
- `apps/dashboard/app/[locale]/collection/page.tsx`, `components/system-grid.tsx` — badges de propriétés
- `apps/dashboard/app/[locale]/collection/[system]/page.tsx` — en-tête enrichi
- `apps/dashboard/app/[locale]/recalboxes/page.tsx`, `app/[locale]/all-recalboxes/page.tsx` — versions
- `apps/dashboard/messages/en.json`, `apps/dashboard/messages/fr.json`

---

### Task 1 : Le transport `client.ts`

**Files:**
- Create: `apps/dashboard/lib/recalbox/manager/client.ts`
- Test: `apps/dashboard/lib/recalbox/manager/__tests__/client.test.ts`

**Interfaces:**
- Consumes: rien (première tâche)
- Produces:
  - `MANAGER_PORT: 81`, `READ_TIMEOUT_MS: 6000`, `WRITE_TIMEOUT_MS: 8000`
  - `managerUrl(host: string, path: string, port?: number): string`
  - `managerRead<T>(host: string, path: string, req?: ManagerRequest): Promise<T | null>`
  - `managerWrite(host: string, path: string, req?: ManagerRequest): Promise<void>`
  - `type ManagerRequest = { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; timeoutMs?: number; port?: number }`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/dashboard/lib/recalbox/manager/__tests__/client.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { managerRead, managerUrl, managerWrite } from '../client'

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

afterEach(() => {
	vi.restoreAllMocks()
})

describe('managerUrl', () => {
	it('builds the api base with the default port', () => {
		expect(managerUrl('box', '/versions')).toBe('http://box:81/api/versions')
	})

	it('honours a custom port', () => {
		expect(managerUrl('box', '/versions', 8081)).toBe('http://box:8081/api/versions')
	})
})

describe('managerRead', () => {
	it('returns the parsed body on success', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ arch: 'rpi5_64' }), { status: 200 }),
		)
		expect(await managerRead<{ arch: string }>('box', '/architecture')).toEqual({
			arch: 'rpi5_64',
		})
	})

	it('returns null on a non-ok response', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
		expect(await managerRead('box', '/architecture')).toBeNull()
	})

	it('returns null when the box is unreachable', async () => {
		vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
		expect(await managerRead('box', '/architecture')).toBeNull()
	})

	it('returns null when the body is not JSON', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(new Response('404 - Not found', { status: 200 }))
		expect(await managerRead('box', '/architecture')).toBeNull()
	})
})

describe('managerWrite', () => {
	it('POSTs a JSON body', async () => {
		const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
		await managerWrite('box', '/configuration/audio', { body: { volume: 90 } })
		const [url, init] = spy.mock.calls[0] ?? []
		expect(url).toBe('http://box:81/api/configuration/audio')
		expect(init?.method).toBe('POST')
		expect(JSON.parse(init?.body as string)).toEqual({ volume: 90 })
	})

	it('sends no body and no content-type when none is given', async () => {
		const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
		await managerWrite('box', '/system/frontend/restart')
		const [, init] = spy.mock.calls[0] ?? []
		expect(init?.body).toBeUndefined()
		expect(init?.headers).toBeUndefined()
	})

	it('throws on a non-ok response without leaking the body', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 400 }))
		await expect(
			managerWrite('box', '/configuration/wifi', { body: { key: 'hunter2' } }),
		).rejects.toThrow(/400/)
		await expect(
			managerWrite('box', '/configuration/wifi', { body: { key: 'hunter2' } }),
		).rejects.not.toThrow(/hunter2/)
	})

	it('supports DELETE', async () => {
		const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
		await managerWrite('box', '/media/shot.png', { method: 'DELETE' })
		expect(spy.mock.calls[0]?.[1]?.method).toBe('DELETE')
	})
})
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd apps/dashboard && pnpm exec vitest run lib/recalbox/manager/__tests__/client.test.ts`
Expected: FAIL — `Failed to resolve import "../client"`

- [ ] **Step 3 : Écrire l'implémentation**

Créer `apps/dashboard/lib/recalbox/manager/client.ts` :

```ts
import { logger } from '@/lib/logger'

/**
 * Transport for the Recalbox Web Manager HTTP API (port 81) — the same API the
 * official Web Manager uses. Every manager module goes through here so the URL
 * shape, the timeouts and the failure contract live in exactly one place.
 *
 * The contract is deliberately asymmetric:
 *   - reads are best-effort and return null, because a box that is powered off
 *     must degrade a panel, never break a page render;
 *   - writes throw, because they are explicit user actions and the route needs
 *     to answer 503.
 */

export const MANAGER_PORT = 81
export const READ_TIMEOUT_MS = 6000
export const WRITE_TIMEOUT_MS = 8000

export type ManagerRequest = {
	method?: 'GET' | 'POST' | 'DELETE'
	body?: unknown
	timeoutMs?: number
	port?: number
}

export function managerUrl(host: string, path: string, port = MANAGER_PORT): string {
	return `http://${host}:${port}/api${path}`
}

function call(host: string, path: string, req: ManagerRequest, fallbackMs: number) {
	const init: RequestInit = {
		method: req.method ?? 'GET',
		signal: AbortSignal.timeout(req.timeoutMs ?? fallbackMs),
	}
	if (req.body !== undefined) {
		init.headers = { 'content-type': 'application/json' }
		init.body = JSON.stringify(req.body)
	}
	return fetch(managerUrl(host, path, req.port), init)
}

/**
 * Best-effort read. Returns null on ANY failure — unreachable box, non-2xx, or
 * a body that isn't JSON (the Manager answers `404 - Not found` in plain text).
 */
export async function managerRead<T>(
	host: string,
	path: string,
	req: ManagerRequest = {},
): Promise<T | null> {
	try {
		const res = await call(host, path, { ...req, method: 'GET' }, READ_TIMEOUT_MS)
		if (!res.ok) {
			logger.warn(`Recalbox Manager GET ${path} answered ${res.status}`)
			return null
		}
		return (await res.json()) as T
	} catch (err) {
		logger.warn(`Recalbox Manager GET ${path} failed`, err)
		return null
	}
}

/**
 * Strict write: throws so routes can surface a 503.
 * The error message carries the path and status only — `req.body` may hold
 * Wi-Fi keys and passwords and must never reach a log or an error string.
 */
export async function managerWrite(
	host: string,
	path: string,
	req: ManagerRequest = {},
): Promise<void> {
	const method = req.method ?? 'POST'
	const res = await call(host, path, { ...req, method }, WRITE_TIMEOUT_MS)
	if (!res.ok) {
		throw new Error(`Recalbox Manager ${method} ${path} failed with status ${res.status}`)
	}
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd apps/dashboard && pnpm exec vitest run lib/recalbox/manager/__tests__/client.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5 : Commit**

```bash
git add apps/dashboard/lib/recalbox/manager/
git commit -m "feat(manager): add a single HTTP transport for the Recalbox Web Manager"
```

---

### Task 2 : Déplacer la configuration dans `manager/config.ts`

Déplacement pur, sans changement de comportement, sauf le transport qui passe par `client.ts`.

**Files:**
- Create: `apps/dashboard/lib/recalbox/manager/config.ts`
- Create: `apps/dashboard/lib/recalbox/manager/__tests__/config.test.ts`
- Modify: `apps/dashboard/app/api/system/frontend/route.ts:6`
- Modify: `apps/dashboard/app/api/recalbox/config/[section]/route.ts:13`
- Modify: `apps/dashboard/app/api/recalbox/config/[section]/__tests__/route.test.ts:26-38`
- Modify: `apps/dashboard/components/config/config-section-form.tsx:20-21`

**Interfaces:**
- Consumes: `managerRead`, `managerWrite` (Task 1)
- Produces: depuis `@/lib/recalbox/manager/config` — `ConfigValue`, `ConfigField`, `FrontendAction`, `SECRET_SENTINEL`, `fetchConfigSection(host, section, port?)`, `saveConfigSection(host, section, changes, port?)`, `restartFrontend(host, action, port?)`, `maskSecrets(fields, isSecret)`

- [ ] **Step 1 : Créer `manager/config.ts`**

Créer `apps/dashboard/lib/recalbox/manager/config.ts` :

```ts
import { managerRead, managerWrite } from './client'

/**
 * Recalbox Web Manager configuration API — the same source the official Web
 * Manager uses to read and write `recalbox.conf`.
 *
 * Wire format, verified against a live box:
 *   GET  /api/configuration/{section}  -> { "<key>": { exist: bool, value: bool|number|string } }
 *   POST /api/configuration/{section}  with a FLAT body { "<key>": <value>, ... }
 *        applies the given keys and returns the full updated section. An empty
 *        body is a no-op that just echoes the current section.
 *   POST /api/system/frontend/{restart|start|stop}  controls EmulationStation.
 */

export type ConfigValue = boolean | number | string

export type ConfigField = {
	key: string
	value: ConfigValue
	exist: boolean
	/** True when the value has been masked before leaving the server (secrets). */
	secret?: boolean
}

export type FrontendAction = 'restart' | 'start' | 'stop'

/**
 * Placeholder sent to the client in place of a secret value, and the signal
 * that a secret field was left untouched and must NOT be written back.
 */
export const SECRET_SENTINEL = '••••••'

type RawEntry = { exist?: boolean; value?: ConfigValue }

/** Read a configuration section. Best-effort: returns [] when unreachable. */
export async function fetchConfigSection(
	host: string,
	section: string,
	port?: number,
): Promise<ConfigField[]> {
	const data = await managerRead<Record<string, RawEntry>>(
		host,
		`/configuration/${section}`,
		{ port },
	)
	return data ? normalizeSection(data) : []
}

/**
 * Write the given keys to a configuration section. Only the keys passed are
 * sent (the API merges them); callers should pass changed keys only. Throws
 * when the box rejects the write or is unreachable, so routes can surface 503.
 */
export async function saveConfigSection(
	host: string,
	section: string,
	changes: Record<string, ConfigValue>,
	port?: number,
): Promise<void> {
	await managerWrite(host, `/configuration/${section}`, { body: changes, port })
}

/** Control EmulationStation (apply settings that need a frontend restart). */
export async function restartFrontend(
	host: string,
	action: FrontendAction,
	port?: number,
): Promise<void> {
	await managerWrite(host, `/system/frontend/${action}`, { port })
}

function normalizeSection(data: Record<string, RawEntry>): ConfigField[] {
	const out: ConfigField[] = []
	for (const [key, raw] of Object.entries(data)) {
		if (!raw || typeof raw !== 'object') continue
		const value = raw.value
		if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
			continue
		}
		out.push({ key, value, exist: raw.exist ?? false })
	}
	return out.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Replace the value of secret keys with {@link SECRET_SENTINEL} so they never
 * reach the browser. `isSecret` decides per key (driven by the config schema).
 */
export function maskSecrets(
	fields: ConfigField[],
	isSecret: (key: string) => boolean,
): ConfigField[] {
	return fields.map((f) =>
		isSecret(f.key) ? { ...f, value: f.value === '' ? '' : SECRET_SENTINEL, secret: true } : f,
	)
}
```

- [ ] **Step 2 : Déplacer les tests de configuration**

Créer `apps/dashboard/lib/recalbox/manager/__tests__/config.test.ts` en reprenant **à l'identique** les blocs `describe('fetchConfigSection')`, `describe('saveConfigSection')` et `describe('maskSecrets')` de `apps/dashboard/lib/recalbox/__tests__/web-config.test.ts`, avec cet en-tête :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	type ConfigField,
	SECRET_SENTINEL,
	fetchConfigSection,
	maskSecrets,
	saveConfigSection,
} from '../config'

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

afterEach(() => {
	vi.restoreAllMocks()
})
```

Ne **pas** reprendre le bloc `describe('fetchSystemsCatalog')` — il part en Task 3.

- [ ] **Step 3 : Mettre à jour les quatre sites d'import**

Dans chacun de ces fichiers, remplacer `@/lib/recalbox/web-config` par `@/lib/recalbox/manager/config` :

- `apps/dashboard/app/api/system/frontend/route.ts` ligne 6
- `apps/dashboard/app/api/recalbox/config/[section]/route.ts` ligne 13
- `apps/dashboard/app/api/recalbox/config/[section]/__tests__/route.test.ts` lignes 26, 28 et 38 (les trois occurrences, dont le chemin du `vi.mock`)
- `apps/dashboard/components/config/config-section-form.tsx` lignes 20 et 21

- [ ] **Step 4 : Lancer les tests concernés**

Run: `cd apps/dashboard && pnpm exec vitest run lib/recalbox/manager app/api/recalbox/config`
Expected: PASS

- [ ] **Step 5 : Commit**

```bash
git add apps/dashboard/lib/recalbox/manager apps/dashboard/app apps/dashboard/components
git commit -m "refactor(manager): move the configuration client into lib/recalbox/manager"
```

---

### Task 3 : Déplacer le catalogue dans `manager/catalog.ts`

Déplacement pur. L'extension des champs arrive en Task 5.

**Files:**
- Create: `apps/dashboard/lib/recalbox/manager/catalog.ts`
- Create: `apps/dashboard/lib/recalbox/manager/__tests__/catalog.test.ts`
- Delete: `apps/dashboard/lib/recalbox/web-config.ts`
- Delete: `apps/dashboard/lib/recalbox/__tests__/web-config.test.ts`
- Modify: `apps/dashboard/app/[locale]/configuration/systems/page.tsx:8`
- Modify: `apps/dashboard/app/api/recalbox/systems/route.ts:5`
- Modify: `apps/dashboard/components/config/systems-catalog.tsx:15`
- Modify: `apps/dashboard/components/collection/emulator-override-button.tsx:22`

**Interfaces:**
- Consumes: `managerRead` (Task 1)
- Produces: depuis `@/lib/recalbox/manager/catalog` — `EmulatorRating`, `EmulatorChoice`, `SystemCatalogEntry`, `fetchSystemsCatalog(host, port?)`

- [ ] **Step 1 : Créer `manager/catalog.ts`**

Créer `apps/dashboard/lib/recalbox/manager/catalog.ts` :

```ts
import { managerRead } from './client'

/**
 * System catalog from the Web Manager (`GET /api/systems`) — the JSON form of
 * the box's `systemlist.xml`. It reflects the Recalbox version actually
 * installed, so it is the authoritative list of which emulators and cores are
 * available, rather than a table maintained by hand.
 */

/** 0 = Unknown, 1 = High, 2 = Good, 3 = Average, 4 = Low (Web Manager enum). */
export type EmulatorRating = 0 | 1 | 2 | 3 | 4

export type EmulatorChoice = {
	emulator: string
	core: string
	/** Lower is the recalbox-recommended default (priority 1). */
	priority: number
	speed: EmulatorRating
	compatibility: EmulatorRating
	hasNetplay: boolean
}

export type SystemCatalogEntry = {
	name: string
	fullName: string
	manufacturer: string
	emulators: EmulatorChoice[]
}

type RawEmulator = {
	emulator?: string
	core?: string
	priority?: number
	speed?: number
	compatibility?: number
	hasNetplay?: boolean
}

type RawSystem = {
	name?: string
	fullName?: string
	manufacturer?: string
	emulators?: RawEmulator[]
}

function toRating(n: number | undefined): EmulatorRating {
	return n === 1 || n === 2 || n === 3 || n === 4 ? n : 0
}

/** Available emulator/core choices per system, from the Web Manager catalog. */
export async function fetchSystemsCatalog(
	host: string,
	port?: number,
): Promise<SystemCatalogEntry[]> {
	const data = await managerRead<{ systems?: RawSystem[] }>(host, '/systems', { port })
	if (!data) return []
	const out: SystemCatalogEntry[] = []
	for (const sys of data.systems ?? []) {
		if (!sys?.name) continue
		const emulators: EmulatorChoice[] = []
		for (const e of sys.emulators ?? []) {
			if (!e?.emulator || !e?.core) continue
			emulators.push({
				emulator: e.emulator,
				core: e.core,
				priority: e.priority ?? 99,
				speed: toRating(e.speed),
				compatibility: toRating(e.compatibility),
				hasNetplay: e.hasNetplay ?? false,
			})
		}
		// Only systems that actually offer an emulator are worth listing.
		if (emulators.length === 0) continue
		emulators.sort((a, b) => a.priority - b.priority)
		out.push({
			name: sys.name,
			fullName: sys.fullName || sys.name,
			manufacturer: sys.manufacturer ?? '',
			emulators,
		})
	}
	return out.sort((a, b) => a.fullName.localeCompare(b.fullName))
}
```

- [ ] **Step 2 : Déplacer les tests du catalogue**

Créer `apps/dashboard/lib/recalbox/manager/__tests__/catalog.test.ts` en reprenant **à l'identique** le bloc `describe('fetchSystemsCatalog')` de `apps/dashboard/lib/recalbox/__tests__/web-config.test.ts`, avec cet en-tête :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSystemsCatalog } from '../catalog'

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

afterEach(() => {
	vi.restoreAllMocks()
})
```

- [ ] **Step 3 : Supprimer les anciens fichiers et mettre à jour les imports**

```bash
git rm apps/dashboard/lib/recalbox/web-config.ts apps/dashboard/lib/recalbox/__tests__/web-config.test.ts
```

Puis remplacer `@/lib/recalbox/web-config` par `@/lib/recalbox/manager/catalog` dans :

- `apps/dashboard/app/[locale]/configuration/systems/page.tsx` ligne 8
- `apps/dashboard/app/api/recalbox/systems/route.ts` ligne 5
- `apps/dashboard/components/config/systems-catalog.tsx` ligne 15
- `apps/dashboard/components/collection/emulator-override-button.tsx` ligne 22

- [ ] **Step 4 : Vérifier qu'aucune référence ne subsiste**

Run: `cd /home/madjid/projets/recalbox-dashboard && grep -rn "recalbox/web-config" apps/dashboard`
Expected: aucune sortie

Run: `cd apps/dashboard && pnpm exec vitest run lib/recalbox/manager && pnpm exec tsc --noEmit`
Expected: PASS, aucune erreur de type

- [ ] **Step 5 : Commit**

```bash
git add -A apps/dashboard
git commit -m "refactor(manager): move the systems catalog into lib/recalbox/manager"
```

---

### Task 4 : Déplacer les BIOS et basculer le stockage sur le transport commun

**Files:**
- Create: `apps/dashboard/lib/recalbox/manager/bios.ts`
- Create: `apps/dashboard/lib/recalbox/manager/__tests__/bios.test.ts`
- Delete: `apps/dashboard/lib/recalbox/bios.ts`, `apps/dashboard/lib/recalbox/__tests__/bios.test.ts`
- Modify: `apps/dashboard/app/api/bios/route.ts:4`
- Modify: `apps/dashboard/components/bios-table.tsx:4`
- Modify: `apps/dashboard/lib/recalbox/storage.ts`

**Interfaces:**
- Consumes: `managerRead` (Task 1)
- Produces: depuis `@/lib/recalbox/manager/bios` — `BiosStatus`, `BiosEntry`, `BiosReport`, `fetchBiosInfo(host, port?)`. `@/lib/recalbox/storage` garde exactement sa signature actuelle : `StorageMount`, `fetchStorageInfo(host, port?)`.

- [ ] **Step 1 : Déplacer `bios.ts`**

```bash
cd /home/madjid/projets/recalbox-dashboard
git mv apps/dashboard/lib/recalbox/bios.ts apps/dashboard/lib/recalbox/manager/bios.ts
git mv apps/dashboard/lib/recalbox/__tests__/bios.test.ts apps/dashboard/lib/recalbox/manager/__tests__/bios.test.ts
```

Dans `manager/bios.ts`, remplacer le corps de `fetchBiosInfo` pour qu'il passe par le transport commun. Le `fetch` direct et son `try/catch` disparaissent ; le reste du fichier (types, `toStatus`, `emptySummary`, normalisation) ne change pas. La forme attendue :

```ts
import { managerRead } from './client'

// … types et helpers inchangés …

export async function fetchBiosInfo(host: string, port?: number): Promise<BiosReport> {
	const data = await managerRead<{ systems?: Record<string, RawSystem> }>(host, '/bios', { port })
	if (!data) return { entries: [], summary: emptySummary() }
	// … normalisation existante, inchangée …
}
```

Adapter le nom du type de la réponse à ce que le fichier utilise déjà — lire l'implémentation actuelle avant d'éditer, et ne changer **que** l'obtention de `data`.

Dans `manager/__tests__/bios.test.ts`, corriger l'import : `from '@/lib/recalbox/manager/bios'`.

- [ ] **Step 2 : Mettre à jour les deux consommateurs des BIOS**

Remplacer `@/lib/recalbox/bios` par `@/lib/recalbox/manager/bios` dans :

- `apps/dashboard/app/api/bios/route.ts` ligne 4
- `apps/dashboard/components/bios-table.tsx` ligne 4

- [ ] **Step 3 : Basculer `storage.ts` sur `managerRead`**

`apps/dashboard/lib/recalbox/storage.ts` **reste à sa place** — son type `StorageMount` est importé par `lib/db/schema.ts`, `lib/recalbox/events.ts` et `lib/agent/ingest-snapshot.ts`, qui décrivent du stockage poussé par l'agent et n'ont rien à voir avec le port 81.

Seul le corps change. Remplacer le bloc `try { const res = await fetch(...) … }` par :

```ts
import { managerRead } from './manager/client'

export async function fetchStorageInfo(host: string, port?: number): Promise<StorageMount[]> {
	const data = await managerRead<{ storages?: Record<string, RawStorage> }>(
		host,
		'/monitoring/storageinfo',
		{ port },
	)
	if (!data) return []
	const seen = new Set<string>()
	const out: StorageMount[] = []
	// … boucle de filtrage/normalisation existante, inchangée …
	return out.sort((a, b) => b.percent - a.percent)
}
```

Le `try/catch` et le `signal: AbortSignal.timeout(4000)` disparaissent : le transport commun s'en charge avec un timeout de 6 s.

- [ ] **Step 4 : Vérifier**

Run: `cd /home/madjid/projets/recalbox-dashboard && grep -rn "recalbox/bios'" apps/dashboard`
Expected: aucune sortie

Run: `cd apps/dashboard && pnpm exec vitest run lib/recalbox lib/rom-audit app/api && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5 : Commit**

```bash
git add -A apps/dashboard
git commit -m "refactor(manager): move the BIOS client and route storage through the shared transport"
```

---

### Task 5 : Étendre le catalogue aux propriétés inexploitées

`GET /api/systems` renvoie plus que ce que le parseur garde. Relevé sur une Recalbox 10.1 :

```json
{ "name": "2048", "fullName": "2048", "manufacturer": "port",
  "releaseDate": "2014-03", "type": 7, "extensions": ".game",
  "inputs": { "pads": 1, "keyboard": 4, "mouse": 4 },
  "properties": { "hasLightgunSupport": false, "isReadOnly": true,
                  "isPort": true, "hasNetplay": false },
  "emulators": [ { "emulator": "libretro", "core": "2048",
                   "availableOnCRT": true, "priority": 1 } ] }
```

La réponse porte aussi un bloc `enumerations` qui donne les libellés anglais des codes entiers. On ne s'en sert **pas** : on fige la correspondance code → slug dans le code, comme le fait déjà `RATING_LABEL` pour `EmulatorRating`. Les libellés affichés doivent venir de next-intl, pas de la box.

**Files:**
- Modify: `apps/dashboard/lib/recalbox/manager/catalog.ts`
- Modify: `apps/dashboard/lib/recalbox/manager/__tests__/catalog.test.ts`

**Interfaces:**
- Consumes: `fetchSystemsCatalog` (Task 3)
- Produces: `SystemCatalogEntry` gagne `type: SystemKind`, `releaseDate: string`, `extensions: string[]`, `properties: SystemProperties`, `inputs: SystemInputs` ; `EmulatorChoice` gagne `availableOnCRT: boolean`. Nouveaux types exportés :
  - `type SystemKind = 'unknown' | 'arcade' | 'console' | 'handheld' | 'computer' | 'fantasy' | 'engine' | 'port' | 'virtual' | 'virtualArcade'`
  - `type DeviceRequirement = 'unknown' | 'mandatory' | 'recommended' | 'optional' | 'none'`
  - `type SystemProperties = { hasLightgunSupport: boolean; hasNetplay: boolean; isPort: boolean; isReadOnly: boolean }`
  - `type SystemInputs = { pads: DeviceRequirement; keyboard: DeviceRequirement; mouse: DeviceRequirement }`

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `apps/dashboard/lib/recalbox/manager/__tests__/catalog.test.ts` :

```ts
describe('fetchSystemsCatalog — extended properties', () => {
	function respondWith(system: Record<string, unknown>) {
		vi.spyOn(global, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ systems: [system] }), { status: 200 }),
		)
	}

	const base = {
		name: 'nes',
		fullName: 'Nintendo Entertainment System',
		emulators: [{ emulator: 'libretro', core: 'fceumm', priority: 1 }],
	}

	it('maps the system type code to a stable slug', async () => {
		respondWith({ ...base, type: 2 })
		expect((await fetchSystemsCatalog('box'))[0]?.type).toBe('console')
	})

	it('falls back to "unknown" for an unmapped type code', async () => {
		respondWith({ ...base, type: 42 })
		expect((await fetchSystemsCatalog('box'))[0]?.type).toBe('unknown')
	})

	it('maps device requirement codes to slugs', async () => {
		respondWith({ ...base, inputs: { pads: 1, keyboard: 4, mouse: 3 } })
		expect((await fetchSystemsCatalog('box'))[0]?.inputs).toEqual({
			pads: 'mandatory',
			keyboard: 'none',
			mouse: 'optional',
		})
	})

	it('defaults every input to "unknown" when the block is absent', async () => {
		respondWith(base)
		expect((await fetchSystemsCatalog('box'))[0]?.inputs).toEqual({
			pads: 'unknown',
			keyboard: 'unknown',
			mouse: 'unknown',
		})
	})

	it('keeps the system properties block', async () => {
		respondWith({
			...base,
			properties: {
				hasLightgunSupport: true,
				hasNetplay: true,
				isPort: false,
				isReadOnly: true,
			},
		})
		expect((await fetchSystemsCatalog('box'))[0]?.properties).toEqual({
			hasLightgunSupport: true,
			hasNetplay: true,
			isPort: false,
			isReadOnly: true,
		})
	})

	it('defaults every property to false when the block is absent', async () => {
		respondWith(base)
		expect((await fetchSystemsCatalog('box'))[0]?.properties).toEqual({
			hasLightgunSupport: false,
			hasNetplay: false,
			isPort: false,
			isReadOnly: false,
		})
	})

	it('splits the extensions string into a trimmed list', async () => {
		respondWith({ ...base, extensions: '.nes .zip  .7z' })
		expect((await fetchSystemsCatalog('box'))[0]?.extensions).toEqual(['.nes', '.zip', '.7z'])
	})

	it('returns an empty extension list when the field is missing', async () => {
		respondWith(base)
		expect((await fetchSystemsCatalog('box'))[0]?.extensions).toEqual([])
	})

	it('keeps releaseDate as the raw YYYY-MM string', async () => {
		respondWith({ ...base, releaseDate: '1983-07' })
		expect((await fetchSystemsCatalog('box'))[0]?.releaseDate).toBe('1983-07')
	})

	it('reads availableOnCRT per emulator, defaulting to false', async () => {
		respondWith({
			...base,
			emulators: [
				{ emulator: 'libretro', core: 'fceumm', priority: 1, availableOnCRT: true },
				{ emulator: 'libretro', core: 'nestopia', priority: 2 },
			],
		})
		const emus = (await fetchSystemsCatalog('box'))[0]?.emulators
		expect(emus?.[0]?.availableOnCRT).toBe(true)
		expect(emus?.[1]?.availableOnCRT).toBe(false)
	})
})
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd apps/dashboard && pnpm exec vitest run lib/recalbox/manager/__tests__/catalog.test.ts`
Expected: FAIL — les nouvelles propriétés sont `undefined`

- [ ] **Step 3 : Étendre le parseur**

Dans `apps/dashboard/lib/recalbox/manager/catalog.ts`, ajouter avant `RawEmulator` :

```ts
/**
 * The Manager reports system types and device requirements as integers, with a
 * companion `enumerations` block giving English labels. We freeze the mapping
 * here instead of reading that block: display strings must come from next-intl,
 * and a stable slug keeps the i18n keys independent of the box's locale.
 */
export type SystemKind =
	| 'unknown'
	| 'arcade'
	| 'console'
	| 'handheld'
	| 'computer'
	| 'fantasy'
	| 'engine'
	| 'port'
	| 'virtual'
	| 'virtualArcade'

const SYSTEM_KINDS: Record<number, SystemKind> = {
	0: 'unknown',
	1: 'arcade',
	2: 'console',
	3: 'handheld',
	4: 'computer',
	5: 'fantasy',
	6: 'engine',
	7: 'port',
	8: 'virtual',
	9: 'virtualArcade',
}

export type DeviceRequirement = 'unknown' | 'mandatory' | 'recommended' | 'optional' | 'none'

const DEVICE_REQUIREMENTS: Record<number, DeviceRequirement> = {
	0: 'unknown',
	1: 'mandatory',
	2: 'recommended',
	3: 'optional',
	4: 'none',
}

export type SystemProperties = {
	hasLightgunSupport: boolean
	hasNetplay: boolean
	isPort: boolean
	isReadOnly: boolean
}

export type SystemInputs = {
	pads: DeviceRequirement
	keyboard: DeviceRequirement
	mouse: DeviceRequirement
}

function toKind(n: number | undefined): SystemKind {
	return (n !== undefined && SYSTEM_KINDS[n]) || 'unknown'
}

function toRequirement(n: number | undefined): DeviceRequirement {
	return (n !== undefined && DEVICE_REQUIREMENTS[n]) || 'unknown'
}
```

Étendre `EmulatorChoice` avec `availableOnCRT: boolean`, `RawEmulator` avec `availableOnCRT?: boolean`, et `SystemCatalogEntry` avec :

```ts
	type: SystemKind
	/** Raw `YYYY-MM` string as reported by the box, or '' when unknown. */
	releaseDate: string
	extensions: string[]
	properties: SystemProperties
	inputs: SystemInputs
```

Étendre `RawSystem` avec :

```ts
	type?: number
	releaseDate?: string
	extensions?: string
	properties?: Partial<SystemProperties>
	inputs?: { pads?: number; keyboard?: number; mouse?: number }
```

Dans la boucle des émulateurs, ajouter `availableOnCRT: e.availableOnCRT ?? false`.

Dans le `out.push({...})`, ajouter :

```ts
		type: toKind(sys.type),
		releaseDate: sys.releaseDate ?? '',
		extensions: (sys.extensions ?? '').split(/\s+/).filter(Boolean),
		properties: {
			hasLightgunSupport: sys.properties?.hasLightgunSupport ?? false,
			hasNetplay: sys.properties?.hasNetplay ?? false,
			isPort: sys.properties?.isPort ?? false,
			isReadOnly: sys.properties?.isReadOnly ?? false,
		},
		inputs: {
			pads: toRequirement(sys.inputs?.pads),
			keyboard: toRequirement(sys.inputs?.keyboard),
			mouse: toRequirement(sys.inputs?.mouse),
		},
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd apps/dashboard && pnpm exec vitest run lib/recalbox/manager/__tests__/catalog.test.ts && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5 : Commit**

```bash
git add apps/dashboard/lib/recalbox/manager
git commit -m "feat(manager): parse system properties, inputs and CRT availability from the catalog"
```

---

### Task 6 : Badges de propriétés sur la grille des systèmes

**Files:**
- Create: `apps/dashboard/components/system-properties.tsx`
- Modify: `apps/dashboard/components/system-grid.tsx`
- Modify: `apps/dashboard/app/[locale]/collection/page.tsx`
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/fr.json`

**Interfaces:**
- Consumes: `fetchSystemsCatalog`, `SystemCatalogEntry`, `SystemProperties` (Task 5)
- Produces:
  - `<SystemPropertyBadges properties={SystemProperties} crt={boolean} />` depuis `@/components/system-properties`
  - `SystemEntry` (dans `system-grid.tsx`) gagne `properties?: SystemProperties` et `crt?: boolean`

- [ ] **Step 1 : Ajouter les clés i18n**

Dans `apps/dashboard/messages/en.json`, sous `"collection"`, ajouter :

```json
		"properties": {
			"lightgun": "Lightgun",
			"netplay": "Netplay",
			"port": "Port",
			"crt": "CRT",
			"readOnly": "Read-only"
		}
```

Dans `apps/dashboard/messages/fr.json`, au même endroit :

```json
		"properties": {
			"lightgun": "Lightgun",
			"netplay": "Netplay",
			"port": "Port",
			"crt": "CRT",
			"readOnly": "Lecture seule"
		}
```

- [ ] **Step 2 : Créer le composant de badges**

Créer `apps/dashboard/components/system-properties.tsx` :

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import type { SystemProperties } from '@/lib/recalbox/manager/catalog'
import { Crosshair, Lock, Monitor, Package, Wifi } from 'lucide-react'
import { useTranslations } from 'next-intl'

type Props = {
	properties: SystemProperties
	/** True when at least one emulator of the system runs on a CRT. */
	crt?: boolean
	className?: string
}

/**
 * Capability badges for a system, straight from the box's own catalog.
 * Renders nothing when the system claims no notable capability — an empty row
 * of badges is noise, and the catalog is absent whenever the box is offline.
 */
export function SystemPropertyBadges({ properties, crt, className }: Props) {
	const t = useTranslations('collection.properties')
	const badges = [
		properties.hasLightgunSupport && { key: 'lightgun', Icon: Crosshair },
		properties.hasNetplay && { key: 'netplay', Icon: Wifi },
		properties.isPort && { key: 'port', Icon: Package },
		crt && { key: 'crt', Icon: Monitor },
		properties.isReadOnly && { key: 'readOnly', Icon: Lock },
	].filter(Boolean) as { key: string; Icon: typeof Wifi }[]

	if (badges.length === 0) return null

	return (
		<div className={className}>
			{badges.map(({ key, Icon }) => (
				<Badge key={key} variant="outline" className="gap-1 text-[10px]">
					<Icon className="size-3" />
					{t(key)}
				</Badge>
			))}
		</div>
	)
}
```

- [ ] **Step 3 : Étendre `SystemEntry` et la carte**

Dans `apps/dashboard/components/system-grid.tsx` :

```tsx
import { SystemPropertyBadges } from '@/components/system-properties'
import type { SystemProperties } from '@/lib/recalbox/manager/catalog'

export type SystemEntry = {
	name: string
	count: number
	/** Absent when the box is offline — badges are simply not rendered. */
	properties?: SystemProperties
	crt?: boolean
}
```

Dans `SystemCard`, juste après le `<div className="flex items-center justify-between gap-2 px-3 py-2">…</div>` de fin, ajouter :

```tsx
				{system.properties && (
					<SystemPropertyBadges
						properties={system.properties}
						crt={system.crt}
						className="flex flex-wrap gap-1 px-3 pb-2"
					/>
				)}
```

- [ ] **Step 4 : Alimenter la grille depuis le catalogue**

Dans `apps/dashboard/app/[locale]/collection/page.tsx`, ajouter aux imports :

```tsx
import { loadRecalbox } from '@/lib/auth/recalbox-acl'
import { fetchSystemsCatalog } from '@/lib/recalbox/manager/catalog'
```

Après le `Promise.all` existant, ajouter la lecture du catalogue et la fusion. La box hors ligne renvoie `[]` : la `Map` est vide, `properties` reste `undefined`, aucun badge n'est rendu.

```tsx
	const host = recalboxId ? (await loadRecalbox(recalboxId))?.host : undefined
	const catalog = host ? await fetchSystemsCatalog(host) : []
	const byName = new Map(catalog.map((c) => [c.name, c]))

	// All systems that have at least one rom, alphabetical like the Web Manager.
	const systems = Object.entries(stats.bySystem)
		.map(([name, count]) => {
			const entry = byName.get(name)
			return {
				name,
				count,
				properties: entry?.properties,
				crt: entry?.emulators.some((e) => e.availableOnCRT),
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name))
```

(remplace le bloc `const systems = …` existant lignes 39-41)

- [ ] **Step 5 : Vérifier le rendu**

Run: `cd apps/dashboard && pnpm exec tsc --noEmit && pnpm lint`
Expected: aucune erreur

Lancer `pnpm dev` puis ouvrir `http://localhost:3000/en/collection`. Attendu : les cartes système portent les badges correspondant à leurs capacités. Couper la box (ou renseigner un hôte injoignable) et recharger : la page s'affiche toujours, sans badge et sans erreur.

- [ ] **Step 6 : Commit**

```bash
git add apps/dashboard
git commit -m "feat(collection): badge systems with their lightgun, netplay, port and CRT support"
```

---

### Task 7 : Enrichir l'en-tête de la fiche système

**Files:**
- Modify: `apps/dashboard/app/[locale]/collection/[system]/page.tsx`
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/fr.json`

**Interfaces:**
- Consumes: `fetchSystemsCatalog`, `SystemPropertyBadges` (Tasks 5 et 6)
- Produces: rien de réutilisable

- [ ] **Step 1 : Ajouter les clés i18n**

Dans `apps/dashboard/messages/en.json`, sous `"collection"` :

```json
		"systemMeta": {
			"released": "Released",
			"extensions": "Extensions",
			"pads": "Controllers",
			"requirement": {
				"mandatory": "required",
				"recommended": "recommended",
				"optional": "optional",
				"none": "not used",
				"unknown": ""
			},
			"kind": {
				"unknown": "System",
				"arcade": "Arcade",
				"console": "Home console",
				"handheld": "Handheld",
				"computer": "Computer",
				"fantasy": "Fantasy console",
				"engine": "Game engine",
				"port": "Port",
				"virtual": "Virtual system",
				"virtualArcade": "Virtual arcade"
			}
		}
```

Dans `apps/dashboard/messages/fr.json` :

```json
		"systemMeta": {
			"released": "Sortie",
			"extensions": "Extensions",
			"pads": "Manettes",
			"requirement": {
				"mandatory": "obligatoires",
				"recommended": "recommandées",
				"optional": "optionnelles",
				"none": "inutilisées",
				"unknown": ""
			},
			"kind": {
				"unknown": "Système",
				"arcade": "Arcade",
				"console": "Console de salon",
				"handheld": "Console portable",
				"computer": "Ordinateur",
				"fantasy": "Console fantasy",
				"engine": "Moteur de jeu",
				"port": "Port",
				"virtual": "Système virtuel",
				"virtualArcade": "Arcade virtuel"
			}
		}
```

- [ ] **Step 2 : Lire le catalogue dans la page**

Dans `apps/dashboard/app/[locale]/collection/[system]/page.tsx`, ajouter aux imports :

```tsx
import { SystemPropertyBadges } from '@/components/system-properties'
import { loadRecalbox } from '@/lib/auth/recalbox-acl'
import { fetchSystemsCatalog } from '@/lib/recalbox/manager/catalog'
```

Après `const gameCount = …` (ligne 28), ajouter :

```tsx
	const host = recalboxId ? (await loadRecalbox(recalboxId))?.host : undefined
	const entry = host ? (await fetchSystemsCatalog(host)).find((s) => s.name === system) : undefined
```

- [ ] **Step 3 : Afficher les métadonnées**

Remplacer le bloc `<div>` du titre (lignes 45-48) par :

```tsx
					<div>
						<h1 className="text-2xl font-bold capitalize">{entry?.fullName ?? system}</h1>
						<p className="text-sm text-muted-foreground">
							{t('totalGames', { count: gameCount })}
							{entry?.manufacturer && ` · ${entry.manufacturer}`}
							{entry?.releaseDate && ` · ${t('systemMeta.released')} ${entry.releaseDate}`}
							{entry && ` · ${t(`systemMeta.kind.${entry.type}`)}`}
						</p>
						{entry && (
							<>
								<SystemPropertyBadges
									properties={entry.properties}
									crt={entry.emulators.some((e) => e.availableOnCRT)}
									className="mt-2 flex flex-wrap gap-1"
								/>
								<p className="mt-1 text-xs text-muted-foreground">
									{entry.extensions.length > 0 &&
										`${t('systemMeta.extensions')} : ${entry.extensions.join(' ')}`}
									{entry.inputs.pads !== 'unknown' &&
										` · ${t('systemMeta.pads')} ${t(`systemMeta.requirement.${entry.inputs.pads}`)}`}
								</p>
							</>
						)}
					</div>
```

- [ ] **Step 4 : Vérifier**

Run: `cd apps/dashboard && pnpm exec tsc --noEmit && pnpm lint`
Expected: aucune erreur

Ouvrir `http://localhost:3000/en/collection/nes`. Attendu : nom complet du système, constructeur, année, type, badges, extensions acceptées. Sur une box hors ligne, l'en-tête retombe sur l'identifiant brut du système et le reste disparaît.

- [ ] **Step 5 : Commit**

```bash
git add apps/dashboard
git commit -m "feat(collection): show manufacturer, release date and accepted extensions on a system page"
```

---

### Task 8 : Le client `versions.ts`

Relevé sur une Recalbox 10.1 : `GET /api/versions` renvoie `{ webapi, recalbox, linux, libretro: { retroarch, cores } }`, où `cores` est un dictionnaire `nom → version` de plus de cent entrées. **Le champ `recalbox` arrive avec un `\n` final** (`"10.1-patron-1\n"`) et `cores` contient une entrée à clé vide (`"": ""`) qu'il faut écarter.

**Files:**
- Create: `apps/dashboard/lib/recalbox/manager/versions.ts`
- Test: `apps/dashboard/lib/recalbox/manager/__tests__/versions.test.ts`

**Interfaces:**
- Consumes: `managerRead` (Task 1)
- Produces: depuis `@/lib/recalbox/manager/versions` —
  - `type CoreVersion = { name: string; version: string }`
  - `type RecalboxVersions = { recalbox: string; linux: string; retroarch: string; webapi: string; cores: CoreVersion[] }`
  - `fetchVersions(host: string, port?: number): Promise<RecalboxVersions | null>`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `apps/dashboard/lib/recalbox/manager/__tests__/versions.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchVersions } from '../versions'

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

afterEach(() => {
	vi.restoreAllMocks()
})

const PAYLOAD = {
	webapi: '2.0',
	recalbox: '10.1-patron-1\n',
	linux: 'Linux version 6.12.25-v8-16k',
	libretro: {
		retroarch: '1.22.2',
		cores: { '': '', '2048': 'v1.0 3891791e06', Amiberry: 'v8.2.2' },
	},
}

describe('fetchVersions', () => {
	it('trims the trailing newline the box adds to the recalbox version', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(PAYLOAD), { status: 200 }),
		)
		expect((await fetchVersions('box'))?.recalbox).toBe('10.1-patron-1')
	})

	it('flattens the cores map and drops the empty-key entry', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(PAYLOAD), { status: 200 }),
		)
		const cores = (await fetchVersions('box'))?.cores
		expect(cores).toEqual([
			{ name: '2048', version: 'v1.0 3891791e06' },
			{ name: 'Amiberry', version: 'v8.2.2' },
		])
	})

	it('exposes linux, retroarch and webapi', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(PAYLOAD), { status: 200 }),
		)
		const v = await fetchVersions('box')
		expect(v?.linux).toBe('Linux version 6.12.25-v8-16k')
		expect(v?.retroarch).toBe('1.22.2')
		expect(v?.webapi).toBe('2.0')
	})

	it('fills missing fields with empty strings rather than failing', async () => {
		vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
		expect(await fetchVersions('box')).toEqual({
			recalbox: '',
			linux: '',
			retroarch: '',
			webapi: '',
			cores: [],
		})
	})

	it('returns null when the box is unreachable', async () => {
		vi.spyOn(global, 'fetch').mockRejectedValue(new Error('down'))
		expect(await fetchVersions('box')).toBeNull()
	})
})
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `cd apps/dashboard && pnpm exec vitest run lib/recalbox/manager/__tests__/versions.test.ts`
Expected: FAIL — `Failed to resolve import "../versions"`

- [ ] **Step 3 : Écrire l'implémentation**

Créer `apps/dashboard/lib/recalbox/manager/versions.ts` :

```ts
import { managerRead } from './client'

/**
 * Version report from `GET /api/versions`. Two quirks of the real payload,
 * observed on a Recalbox 10.1:
 *   - `recalbox` carries a trailing newline ("10.1-patron-1\n");
 *   - `libretro.cores` contains a placeholder entry with an empty key.
 */

export type CoreVersion = { name: string; version: string }

export type RecalboxVersions = {
	recalbox: string
	linux: string
	retroarch: string
	webapi: string
	cores: CoreVersion[]
}

type RawVersions = {
	webapi?: string
	recalbox?: string
	linux?: string
	libretro?: { retroarch?: string; cores?: Record<string, string> }
}

/** Returns null when the box is unreachable — callers show an "unknown" state. */
export async function fetchVersions(
	host: string,
	port?: number,
): Promise<RecalboxVersions | null> {
	const data = await managerRead<RawVersions>(host, '/versions', { port })
	if (!data) return null

	const cores: CoreVersion[] = []
	for (const [name, version] of Object.entries(data.libretro?.cores ?? {})) {
		if (!name) continue
		cores.push({ name, version })
	}
	cores.sort((a, b) => a.name.localeCompare(b.name))

	return {
		recalbox: (data.recalbox ?? '').trim(),
		linux: (data.linux ?? '').trim(),
		retroarch: (data.libretro?.retroarch ?? '').trim(),
		webapi: (data.webapi ?? '').trim(),
		cores,
	}
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `cd apps/dashboard && pnpm exec vitest run lib/recalbox/manager/__tests__/versions.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5 : Commit**

```bash
git add apps/dashboard/lib/recalbox/manager
git commit -m "feat(manager): read Recalbox, kernel, RetroArch and core versions"
```

---

### Task 9 : Afficher les versions et signaler les divergences

**Files:**
- Create: `apps/dashboard/components/recalbox-version-card.tsx`
- Modify: `apps/dashboard/app/[locale]/recalboxes/page.tsx`
- Modify: `apps/dashboard/app/[locale]/all-recalboxes/page.tsx`
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/fr.json`

**Interfaces:**
- Consumes: `fetchVersions`, `RecalboxVersions` (Task 8)
- Produces: `<RecalboxVersionInfo versions={RecalboxVersions | null} outdated?: boolean />` depuis `@/components/recalbox-version-card`

- [ ] **Step 1 : Ajouter les clés i18n**

Dans `apps/dashboard/messages/en.json`, sous `"recalboxes"` :

```json
		"versions": {
			"unknown": "Version unknown (box unreachable)",
			"kernel": "Kernel",
			"retroarch": "RetroArch",
			"coresCount": "{count, plural, one {# core} other {# cores}}",
			"outdated": "Behind another Recalbox"
		}
```

Dans `apps/dashboard/messages/fr.json` :

```json
		"versions": {
			"unknown": "Version inconnue (box injoignable)",
			"kernel": "Noyau",
			"retroarch": "RetroArch",
			"coresCount": "{count, plural, one {# core} other {# cores}}",
			"outdated": "En retard sur une autre Recalbox"
		}
```

- [ ] **Step 2 : Créer le composant**

Créer `apps/dashboard/components/recalbox-version-card.tsx` :

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import type { RecalboxVersions } from '@/lib/recalbox/manager/versions'
import { useTranslations } from 'next-intl'

type Props = {
	/** Null when the box could not be reached. */
	versions: RecalboxVersions | null
	/** True when another box in the fleet runs a different Recalbox version. */
	outdated?: boolean
}

export function RecalboxVersionInfo({ versions, outdated }: Props) {
	const t = useTranslations('recalboxes.versions')

	if (!versions) {
		return <p className="text-xs text-muted-foreground">{t('unknown')}</p>
	}

	return (
		<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
			<span className="font-medium text-foreground">{versions.recalbox || '—'}</span>
			{outdated && (
				<Badge variant="outline" className="text-[10px]">
					{t('outdated')}
				</Badge>
			)}
			{versions.retroarch && (
				<span>
					{t('retroarch')} {versions.retroarch}
				</span>
			)}
			{versions.cores.length > 0 && <span>{t('coresCount', { count: versions.cores.length })}</span>}
			{versions.linux && <span title={versions.linux}>{t('kernel')}</span>}
		</div>
	)
}
```

- [ ] **Step 3 : Afficher la version sur la liste des boxes**

Dans `apps/dashboard/app/[locale]/recalboxes/page.tsx`, ajouter aux imports :

```tsx
import { RecalboxVersionInfo } from '@/components/recalbox-version-card'
import { fetchVersions } from '@/lib/recalbox/manager/versions'
```

Après `const archived = …` (ligne 18), lire les versions en parallèle — une box injoignable donne `null`, jamais une exception :

```tsx
	const versions = new Map(
		await Promise.all(
			active.map(async (rb) => [rb.id, rb.host ? await fetchVersions(rb.host) : null] as const),
		),
	)
```

Dans le `<CardContent>` de chaque box, ajouter :

```tsx
							<RecalboxVersionInfo versions={versions.get(rb.id) ?? null} />
```

- [ ] **Step 4 : Signaler les divergences sur la vue multi-box**

Dans `apps/dashboard/app/[locale]/all-recalboxes/page.tsx`, ajouter aux imports :

```tsx
import { RecalboxVersionInfo } from '@/components/recalbox-version-card'
import { fetchVersions } from '@/lib/recalbox/manager/versions'
```

Remplacer le `statsPerRb` (lignes 16-21) par une version qui lit aussi les versions :

```tsx
	const statsPerRb = await Promise.all(
		all.map(async (rb) => {
			const [stats, versions] = await Promise.all([
				getSessionStats({ recalboxId: rb.id }),
				rb.host ? fetchVersions(rb.host) : Promise.resolve(null),
			])
			return { rb, stats, versions }
		}),
	)

	// A box is flagged when the fleet doesn't agree on a Recalbox version.
	// Boxes we couldn't reach are ignored: silence is not disagreement.
	const known = new Set(
		statsPerRb.map(({ versions }) => versions?.recalbox).filter((v): v is string => !!v),
	)
	const diverges = known.size > 1
```

Puis, dans la boucle de rendu, remplacer `{statsPerRb.map(({ rb, stats }) => (` par `{statsPerRb.map(({ rb, stats, versions }) => (` et ajouter après le `<div className="text-sm text-muted-foreground flex gap-4">…</div>` :

```tsx
							<RecalboxVersionInfo
								versions={versions}
								outdated={diverges && !!versions?.recalbox}
							/>
```

- [ ] **Step 5 : Vérifier**

Run: `cd apps/dashboard && pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run`
Expected: aucune erreur, toute la suite passe

Ouvrir `http://localhost:3000/en/recalboxes` puis `/en/all-recalboxes`. Attendu : la version Recalbox, RetroArch et le nombre de cores sur chaque box ; « Version inconnue » sur une box éteinte, sans erreur de rendu.

- [ ] **Step 6 : Commit**

```bash
git add apps/dashboard
git commit -m "feat(recalboxes): surface Recalbox, RetroArch and core versions per box"
```

---

### Task 10 : Badge CRT par core sur la page de configuration

`components/config/systems-catalog.tsx` liste déjà chaque core avec ses badges vitesse, compatibilité et netplay. `availableOnCRT` complète la série : c'est l'information qui manque à quelqu'un qui joue sur écran cathodique.

**Files:**
- Modify: `apps/dashboard/components/config/systems-catalog.tsx`
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/fr.json`

**Interfaces:**
- Consumes: `EmulatorChoice.availableOnCRT` (Task 5)
- Produces: rien de réutilisable

- [ ] **Step 1 : Ajouter la clé i18n**

Dans `apps/dashboard/messages/en.json`, sous `"config"` → `"systems"`, à côté de `"netplay"` :

```json
			"crt": "CRT",
```

Même ajout dans `apps/dashboard/messages/fr.json` (le libellé est identique en français).

- [ ] **Step 2 : Rendre le badge**

Dans `apps/dashboard/components/config/systems-catalog.tsx`, ajouter `Monitor` à l'import de `lucide-react` :

```tsx
import { Loader2, Monitor, Search, Star, Wifi } from 'lucide-react'
```

Puis, juste après le bloc `{e.hasNetplay && ( … )}` dans `SystemCard` :

```tsx
									{e.availableOnCRT && (
										<Badge variant="outline" className="gap-1 text-[10px]">
											<Monitor className="size-3" />
											{t('systems.crt')}
										</Badge>
									)}
```

- [ ] **Step 3 : Vérifier**

Run: `cd apps/dashboard && pnpm exec tsc --noEmit && pnpm lint`
Expected: aucune erreur

Ouvrir `http://localhost:3000/en/configuration/systems`. Attendu : les cores disponibles sur CRT portent un badge supplémentaire.

- [ ] **Step 4 : Commit**

```bash
git add apps/dashboard
git commit -m "feat(config): flag emulator cores available on CRT"
```

---

## Vérification finale

- [ ] `cd apps/dashboard && pnpm exec vitest run` — toute la suite passe
- [ ] `cd apps/dashboard && pnpm exec tsc --noEmit` — aucune erreur de type
- [ ] `pnpm lint` — propre
- [ ] `grep -rn "recalbox/web-config\|recalbox/bios'" apps/dashboard` — aucune sortie
- [ ] Sur une box réelle : `/collection`, `/collection/<system>`, `/recalboxes`, `/all-recalboxes` affichent les nouvelles données
- [ ] Box éteinte : les quatre mêmes pages se rendent sans erreur, avec les zones concernées vides ou marquées « inconnu »
