# Mise à jour automatique de l'agent — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'agent installé sur une Recalbox converge tout seul vers la version que le cloud lui désigne, se répare s'il ne démarre plus, et le parc se déploie par paliers observables depuis `/admin`.

**Architecture:** La cible voyage dans la réponse de la boucle de commandes existante (aucune nouvelle boucle réseau) ; l'agent renvoie sa version dans un en-tête, noté sur la ligne qui porte déjà son signal de présence. La bascule télécharge à côté, vérifie par `py_compile`, sauvegarde l'ancien paquet sur la box, puis se relance par `execv`. Un témoin non confirmé au bout de dix minutes déclenche la restauration depuis `launch.py`.

**Tech Stack:** Next.js 16 (App Router, route handlers Node.js), Drizzle ORM sur SQLite/Turso, Vitest, Zod, Biome ; agent Python 3 sans dépendance (stdlib `unittest`).

**Spec:** [`docs/superpowers/specs/2026-08-26-agent-auto-update-design.md`](../specs/2026-08-26-agent-auto-update-design.md)

## Global Constraints

- **TypeScript/TSX** : tabulations, guillemets simples, pas de point-virgule, virgules finales (Biome). Alias `@` → `apps/dashboard/`.
- **Python** : 4 espaces, **stdlib uniquement** — l'agent est délibérément sans dépendance, RecalboxOS ne fournit que Python 3 et `paho-mqtt`.
- **Tests TS** : Vitest, dans un sous-dossier `__tests__/` à côté du code testé. `cd apps/dashboard && pnpm exec vitest run <fichier>`.
- **Tests Python** : `python3 -m unittest discover -s agent -v` depuis la racine du dépôt.
- **Casse du protocole agent** : `snake_case` sur le fil (`rom_path`, `captured_at`, `target_version`). Les clés de la table `settings` restent en `camelCase` après le point (`agent.targetVersion`).
- **Commits** : Conventional Commits (`feat(area):`, `fix(area):`, `docs(area):`).
- **Trois listes de fichiers de l'agent doivent rester synchronisées** : `apps/dashboard/scripts/copy-agent-payload.mjs` (`FILES`), `apps/dashboard/next.config.ts` (`outputFileTracingIncludes`), `apps/dashboard/lib/agent/payload.ts` (`readAgentPayload`). En toucher une sans les autres casse la production sans casser le local.
- **Constantes fixées par la spec** : délai de grâce du témoin = `600` secondes ; paliers de déploiement = `0, 10, 25, 50, 100` ; seau = `sha256(recalbox_id)` modulo `100`.

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `apps/dashboard/lib/agent/version.ts` | **créé** — comparaison de versions pointées, rien d'autre |
| `apps/dashboard/lib/agent/rollout.ts` | **créé** — tirage du seau et fonction de résolution pure |
| `apps/dashboard/lib/agent/rollout-settings.ts` | **créé** — lecture/écriture des deux réglages `agent.*` |
| `apps/dashboard/lib/db/agent-rollout-queries.ts` | **créé** — canal d'une box, répartition des versions du parc |
| `apps/dashboard/app/api/agent/download/route.ts` | **créé** — sert le paquet du déploiement, jeton machine |
| `apps/dashboard/app/api/agent-rollout/route.ts` | **créé** — lecture/écriture des commandes de déploiement, `isAdmin` |
| `apps/dashboard/components/admin/agent-rollout-section.tsx` | **créé** — tableau des versions + paliers |
| `apps/dashboard/components/agent-channel-section.tsx` | **créé** — sélecteur `stable`/`beta` sur la page d'édition |
| `agent/updater.py` | **créé** — comparaison, vérification, bascule, témoin, restauration, journal des échecs |
| `agent/agent.py` | modifié — en-tête de version, libération du verrou avant `execv`, branchement de la mise à jour |
| `agent/launch.py` | modifié — vérification du témoin, restauration, variable d'environnement |
| `apps/dashboard/lib/agent/payload.ts` | modifié — `updater.py` dans le paquet, `readAgentVersion()` mémoïsée |
| `apps/dashboard/lib/agent/installer-zip.ts` | modifié — le zip embarque `updater.py` et `VERSION` |
| `apps/dashboard/lib/agent/bearer.ts` | modifié — `getAgentVersion()` |
| `apps/dashboard/lib/db/agent-queries.ts` | modifié — `touchLastUsed` écrit la version |
| `apps/dashboard/lib/db/schema.ts` | modifié — deux colonnes |
| `apps/dashboard/app/api/agent/commands/route.ts` | modifié — ajoute `agent.target_version` |
| `apps/dashboard/app/api/recalboxes/[id]/route.ts` | modifié — `agentChannel` dans `updateSchema` |

---

### Task 1 : comparaison de versions et résolution de la cible

Toute la logique de déploiement tient dans deux fonctions pures, sans base de données ni requête. C'est le cœur de la pièce A de la spec, et le seul endroit où l'on décide qui bascule.

**Files:**
- Create: `apps/dashboard/lib/agent/version.ts`
- Create: `apps/dashboard/lib/agent/rollout.ts`
- Test: `apps/dashboard/lib/agent/__tests__/version.test.ts`
- Test: `apps/dashboard/lib/agent/__tests__/rollout.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `compareVersions(a: string, b: string): number` — négatif si `a < b`, `0` si égales, positif si `a > b`.
  - `type AgentChannel = 'stable' | 'beta'`
  - `bucketFor(recalboxId: string): number` — entier de 0 à 99.
  - `type RolloutInput = { channel: AgentChannel; recalboxId: string; currentVersion: string | null; targetVersion: string; rolloutPercent: number }`
  - `resolveTargetVersion(input: RolloutInput): string | null`

- [ ] **Step 1 : écrire les tests de comparaison**

Créer `apps/dashboard/lib/agent/__tests__/version.test.ts` :

```ts
import { compareVersions } from '@/lib/agent/version'
import { describe, expect, it } from 'vitest'

describe('compareVersions', () => {
	it('orders by numeric segment, not lexicographically', () => {
		expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
		expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0)
	})

	it('treats equal versions as equal', () => {
		expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
	})

	it('pads missing segments with zero', () => {
		expect(compareVersions('1.1', '1.1.0')).toBe(0)
		expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0)
	})

	it('reads a non-numeric segment as zero rather than throwing', () => {
		expect(compareVersions('1.x.0', '1.0.0')).toBe(0)
		expect(compareVersions('', '0.0.0')).toBe(0)
	})
})
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/version.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/agent/version"`.

- [ ] **Step 3 : écrire `version.ts`**

```ts
/**
 * Compare deux versions pointées (`1.10.0` vs `1.9.0`), segment par segment.
 *
 * Une comparaison de chaînes classerait `1.10.0` AVANT `1.9.0` : c'est
 * exactement l'erreur qui ferait descendre tout un parc en croyant le monter.
 * Un segment illisible vaut 0 plutôt qu'une exception — cette fonction est
 * appelée sur une valeur qui vient du réseau, et lever ici couperait la boucle
 * de commandes de la box.
 */
export function compareVersions(a: string, b: string): number {
	const pa = a.split('.')
	const pb = b.split('.')
	const len = Math.max(pa.length, pb.length)
	for (let i = 0; i < len; i++) {
		const na = segment(pa[i])
		const nb = segment(pb[i])
		if (na !== nb) return na - nb
	}
	return 0
}

function segment(raw: string | undefined): number {
	const n = Number.parseInt(raw ?? '0', 10)
	return Number.isNaN(n) ? 0 : n
}
```

- [ ] **Step 4 : lancer le test, vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/version.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5 : écrire les tests de résolution**

Créer `apps/dashboard/lib/agent/__tests__/rollout.test.ts` :

```ts
import { type RolloutInput, bucketFor, resolveTargetVersion } from '@/lib/agent/rollout'
import { describe, expect, it } from 'vitest'

function input(over: Partial<RolloutInput> = {}): RolloutInput {
	return {
		channel: 'stable',
		recalboxId: 'rb-1',
		currentVersion: '1.0.0',
		targetVersion: '1.1.0',
		rolloutPercent: 0,
		...over,
	}
}

describe('bucketFor', () => {
	it('is deterministic for a given id', () => {
		expect(bucketFor('rb-1')).toBe(bucketFor('rb-1'))
	})

	it('stays within 0..99', () => {
		for (const id of ['a', 'b', 'c', 'rb-1', 'rb-2', 'rb-3']) {
			const b = bucketFor(id)
			expect(b).toBeGreaterThanOrEqual(0)
			expect(b).toBeLessThan(100)
		}
	})
})

describe('resolveTargetVersion', () => {
	it('says nothing when the box already runs the target', () => {
		expect(resolveTargetVersion(input({ currentVersion: '1.1.0' }))).toBeNull()
	})

	it('says nothing when the box never declared its version', () => {
		expect(resolveTargetVersion(input({ currentVersion: null, rolloutPercent: 100 }))).toBeNull()
	})

	it('holds a stable box back at 0 percent', () => {
		expect(resolveTargetVersion(input())).toBeNull()
	})

	it('serves every stable box at 100 percent', () => {
		expect(resolveTargetVersion(input({ rolloutPercent: 100 }))).toBe('1.1.0')
	})

	it('serves a beta box whatever the percentage', () => {
		expect(resolveTargetVersion(input({ channel: 'beta', rolloutPercent: 0 }))).toBe('1.1.0')
	})

	it('never filters a descent — the emergency button is one gesture', () => {
		const res = resolveTargetVersion(
			input({ currentVersion: '1.1.0', targetVersion: '1.0.0', rolloutPercent: 0 }),
		)
		expect(res).toBe('1.0.0')
	})

	it('keeps a box in the batch as the percentage rises', () => {
		// A box drawn at 10% must still be in at 25% and 50%, otherwise boxes would
		// oscillate between two versions every 60 seconds.
		const ids = Array.from({ length: 200 }, (_, i) => `rb-${i}`)
		const at10 = ids.filter((id) => resolveTargetVersion(input({ recalboxId: id, rolloutPercent: 10 })))
		expect(at10.length).toBeGreaterThan(0)
		for (const id of at10) {
			expect(resolveTargetVersion(input({ recalboxId: id, rolloutPercent: 25 }))).toBe('1.1.0')
			expect(resolveTargetVersion(input({ recalboxId: id, rolloutPercent: 50 }))).toBe('1.1.0')
		}
	})
})
```

- [ ] **Step 6 : lancer le test, vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/rollout.test.ts`
Expected: FAIL — module `@/lib/agent/rollout` introuvable.

- [ ] **Step 7 : écrire `rollout.ts`**

```ts
import { createHash } from 'node:crypto'
import { compareVersions } from '@/lib/agent/version'

export type AgentChannel = 'stable' | 'beta'

export type RolloutInput = {
	channel: AgentChannel
	recalboxId: string
	/** Ce que la box déclare exécuter, via `X-Agent-Version`. */
	currentVersion: string | null
	targetVersion: string
	rolloutPercent: number
}

/**
 * Seau de 0 à 99, déterministe. Un tirage aléatoire à chaque interrogation
 * ferait osciller les box entre deux versions toutes les 60 secondes ; le
 * hachage garantit qu'une box tirée dans les 10 % y reste à 25 %.
 */
export function bucketFor(recalboxId: string): number {
	return createHash('sha256').update(recalboxId).digest().readUInt32BE(0) % 100
}

/**
 * La version que cette box doit exécuter, ou `null` quand le cloud n'a rien à
 * lui dire — auquel cas elle garde ce qu'elle exécute.
 */
export function resolveTargetVersion(input: RolloutInput): string | null {
	const { channel, recalboxId, currentVersion, targetVersion, rolloutPercent } = input

	// Sans point de départ on ne peut pas distinguer une montée d'une descente,
	// et un agent trop ancien pour déclarer sa version est de toute façon trop
	// ancien pour comprendre le champ qu'on lui renverrait.
	if (!currentVersion) return null

	const cmp = compareVersions(targetVersion, currentVersion)
	if (cmp === 0) return null

	// Le pourcentage protège une montée ; une descente n'a pas besoin d'être
	// protégée, elle EST la protection. Sans cette ligne, rapatrier le parc
	// demanderait deux gestes coordonnés — et un bouton d'urgence qui demande
	// deux gestes n'en est pas un.
	if (cmp < 0) return targetVersion

	if (channel === 'beta') return targetVersion
	if (bucketFor(recalboxId) < rolloutPercent) return targetVersion
	return null
}
```

- [ ] **Step 8 : lancer les deux tests, vérifier qu'ils passent**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/version.test.ts lib/agent/__tests__/rollout.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 9 : lint et commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
git add apps/dashboard/lib/agent/version.ts apps/dashboard/lib/agent/rollout.ts apps/dashboard/lib/agent/__tests__/version.test.ts apps/dashboard/lib/agent/__tests__/rollout.test.ts
git commit -m "feat(agent): add version comparison and deterministic rollout resolution"
```

---

### Task 2 : les deux colonnes

**Files:**
- Modify: `apps/dashboard/lib/db/schema.ts` (`recalboxes`, vers la ligne 5 ; `agentTokens`, vers la ligne 571)
- Create: `apps/dashboard/drizzle/migrations/00NN_*.sql` (généré, ne pas écrire à la main)

**Interfaces:**
- Consumes: rien.
- Produces: `recalboxes.agentChannel` (colonne `agent_channel`, texte, défaut `'stable'`) et `agentTokens.agentVersion` (colonne `agent_version`, texte, nullable).

- [ ] **Step 1 : ajouter la colonne de canal**

Dans `apps/dashboard/lib/db/schema.ts`, table `recalboxes`, après `ownerUserId` :

```ts
		ownerUserId: text('owner_user_id'),
		// 'stable' | 'beta' — les box `beta` prennent la version cible immédiatement,
		// quel que soit le pourcentage de déploiement. Le canal est explicite plutôt
		// que tiré au sort : c'est ce qui permet de mettre SA box en première ligne
		// et celle d'un utilisateur en retrait.
		agentChannel: text('agent_channel').notNull().default('stable'),
```

- [ ] **Step 2 : ajouter la colonne de version**

Dans la même table `agentTokens`, après `lastUsedAt` :

```ts
		lastUsedAt: int('last_used_at', { mode: 'timestamp' }),
		// Version que l'agent déclare exécuter (en-tête `X-Agent-Version`), écrite
		// par le même UPDATE que `lastUsedAt` : une colonne, pas une requête.
		agentVersion: text('agent_version'),
```

- [ ] **Step 3 : générer la migration**

Run: `cd apps/dashboard && pnpm exec drizzle-kit generate`
Expected: un nouveau fichier `drizzle/migrations/00NN_<nom>.sql` et une entrée de plus dans `meta/_journal.json`.

- [ ] **Step 4 : relire le SQL généré**

Run: `cat apps/dashboard/drizzle/migrations/00*_*.sql | tail -20`
Expected: deux `ALTER TABLE ... ADD ...`, dont `agent_channel` avec `DEFAULT 'stable' NOT NULL`. **Si le SQL contient un `DROP TABLE` ou une recréation de table, s'arrêter et le signaler** — SQLite force parfois Drizzle à recréer une table, et la table `recalboxes` porte des mots de passe SSH.

- [ ] **Step 5 : appliquer la migration en local**

Run: `cd apps/dashboard && pnpm exec drizzle-kit migrate`
Expected: succès sans erreur.

- [ ] **Step 6 : vérifier que la suite complète passe toujours**

Run: `cd apps/dashboard && pnpm exec vitest run`
Expected: PASS, aucun test en échec.

- [ ] **Step 7 : commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
git add apps/dashboard/lib/db/schema.ts apps/dashboard/drizzle/migrations/
git commit -m "feat(agent): add agent_channel and agent_version columns"
```

---

### Task 3 : la box déclare sa version

L'agent estampille chaque requête ; le serveur la note dans la mise à jour qui existe déjà. C'est ce qui rend visible, plus tard, un lot qui va mal.

**Files:**
- Modify: `apps/dashboard/lib/agent/bearer.ts`
- Modify: `apps/dashboard/lib/db/agent-queries.ts:44-110`
- Modify: les neuf appels de `resolveAgentToken` — `app/api/agent/{collection,rom-scan,snapshots,commands,commands/result,ingest,now-playing}/route.ts` et **deux fois** dans `app/api/agent/artwork/route.ts` (lignes 18 et 38)
- Test: `apps/dashboard/lib/agent/__tests__/bearer.test.ts` (existe peut-être déjà — y ajouter le bloc)

**Interfaces:**
- Consumes: `agentTokens.agentVersion` (Task 2).
- Produces:
  - `getAgentVersion(req: NextRequest): string | null`
  - `resolveAgentToken(db: DB, rawToken: string, agentVersion?: string | null): Promise<{ recalboxId: string; tokenId: string } | null>` — troisième paramètre **optionnel**, pour ne pas casser les appels existants.

- [ ] **Step 1 : écrire le test de l'en-tête**

Créer ou compléter `apps/dashboard/lib/agent/__tests__/bearer.test.ts` :

```ts
import { getAgentVersion } from '@/lib/agent/bearer'
import { describe, expect, it } from 'vitest'

function req(value: string | null) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'x-agent-version' ? value : null) },
	} as never
}

describe('getAgentVersion', () => {
	it('reads a dotted numeric version', () => {
		expect(getAgentVersion(req('1.1.0'))).toBe('1.1.0')
	})

	it('trims surrounding whitespace', () => {
		expect(getAgentVersion(req('  1.1.0\n'))).toBe('1.1.0')
	})

	it('returns null when the header is absent or empty', () => {
		expect(getAgentVersion(req(null))).toBeNull()
		expect(getAgentVersion(req('   '))).toBeNull()
	})

	it('rejects anything that is not a dotted number', () => {
		// This string reaches the database and a version comparison; an agent is
		// free to send anything, so the shape is checked before it lands.
		expect(getAgentVersion(req('1.1.0; DROP TABLE'))).toBeNull()
		expect(getAgentVersion(req('latest'))).toBeNull()
		expect(getAgentVersion(req('1.'.repeat(200)))).toBeNull()
	})
})
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/bearer.test.ts`
Expected: FAIL — `getAgentVersion` n'est pas exportée.

- [ ] **Step 3 : ajouter `getAgentVersion` à `bearer.ts`**

```ts
/** Au plus quatre segments numériques : borne la longueur autant que la forme. */
const AGENT_VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/

/**
 * La version que l'agent déclare exécuter (`X-Agent-Version`). `null` quand
 * l'en-tête est absent — un agent antérieur au mécanisme — ou malformé.
 *
 * La valeur est écrite en base et comparée à une version cible ; un agent est
 * libre d'envoyer n'importe quoi, donc la forme est vérifiée ici, une fois,
 * plutôt qu'à chaque usage.
 */
export function getAgentVersion(req: NextRequest): string | null {
	const raw = req.headers.get('x-agent-version')?.trim()
	if (!raw) return null
	return AGENT_VERSION_RE.test(raw) ? raw : null
}
```

- [ ] **Step 4 : lancer le test, vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/bearer.test.ts`
Expected: PASS.

- [ ] **Step 5 : faire écrire la version par `touchLastUsed`**

Dans `apps/dashboard/lib/db/agent-queries.ts`, changer la signature de `resolveAgentToken` et propager :

```ts
export async function resolveAgentToken(
	db: DB,
	rawToken: string,
	agentVersion?: string | null,
): Promise<{ recalboxId: string; tokenId: string } | null> {
```

Puis dans le corps, remplacer les deux appels à `cleanupOnFirstUse` par :

```ts
	try {
		after(() => cleanupOnFirstUse(db, row.id, row.recalboxId, isFirstCheckIn, agentVersion))
	} catch {
		await cleanupOnFirstUse(db, row.id, row.recalboxId, isFirstCheckIn, agentVersion)
	}
```

Et adapter les deux fonctions internes :

```ts
async function cleanupOnFirstUse(
	db: DB,
	tokenId: string,
	recalboxId: string,
	isFirstCheckIn: boolean,
	agentVersion?: string | null,
): Promise<void> {
	await touchLastUsed(db, tokenId, agentVersion)
	if (isFirstCheckIn) {
		await revokeSiblingInstallerTokens(db, recalboxId, tokenId)
	}
}

/** Best-effort liveness touch: never let a failed write break the caller's request. */
async function touchLastUsed(
	db: DB,
	tokenId: string,
	agentVersion?: string | null,
): Promise<void> {
	try {
		// Une requête SANS en-tête n'efface pas une version déjà connue : un agent
		// qui déclare sa version sur sa boucle de commandes ne la répète pas
		// forcément partout, et écraser avec `null` ferait clignoter le tableau
		// de déploiement.
		const patch: { lastUsedAt: Date; agentVersion?: string } = { lastUsedAt: new Date() }
		if (agentVersion) patch.agentVersion = agentVersion
		await db.update(agentTokens).set(patch).where(eq(agentTokens.id, tokenId))
	} catch (err) {
		logger.error('[agent] lastUsedAt touch failed', err)
	}
}
```

- [ ] **Step 6 : passer l'en-tête depuis les neuf appels**

Dans chacun de ces fichiers, importer `getAgentVersion` à côté de `getBearerToken` et passer le troisième argument :

```ts
import { getAgentVersion, getBearerToken } from '@/lib/agent/bearer'
// …
	const resolved = await resolveAgentToken(db, token, getAgentVersion(req))
```

Fichiers : `app/api/agent/collection/route.ts:27`, `app/api/agent/rom-scan/route.ts:72`, `app/api/agent/snapshots/route.ts:36`, `app/api/agent/commands/route.ts:16`, `app/api/agent/commands/result/route.ts:23`, `app/api/agent/ingest/route.ts:30`, `app/api/agent/now-playing/route.ts:30`, et **les deux appels** de `app/api/agent/artwork/route.ts` (lignes 18 et 38 — vérifier le nom de la variable de requête dans chaque fonction).

- [ ] **Step 7 : vérifier que rien n'a cassé**

Run: `cd apps/dashboard && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS des deux côtés. Les tests existants passent `resolveAgentToken(db, token)` à deux arguments — le troisième est optionnel, donc ils continuent de compiler.

- [ ] **Step 8 : lint et commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
git add apps/dashboard/lib/agent/bearer.ts apps/dashboard/lib/agent/__tests__/bearer.test.ts apps/dashboard/lib/db/agent-queries.ts apps/dashboard/app/api/agent/
git commit -m "feat(agent): record the agent-declared version on every check-in"
```

---

### Task 4 : les deux réglages de déploiement

**Files:**
- Create: `apps/dashboard/lib/agent/rollout-settings.ts`
- Modify: `apps/dashboard/lib/agent/payload.ts` (ajouter `readAgentVersion`)
- Test: `apps/dashboard/lib/agent/__tests__/rollout-settings.test.ts`

**Interfaces:**
- Consumes: `getAllSettings()`, `upsertSetting()` de `@/lib/db/queries`.
- Produces:
  - `readAgentVersion(dirs?: AgentPayloadDirs): Promise<string>` — version du déploiement, mémoïsée quand aucun dossier n'est injecté.
  - `TARGET_VERSION_KEY = 'agent.targetVersion'`, `ROLLOUT_PERCENT_KEY = 'agent.rolloutPercent'`
  - `type RolloutSettings = { targetVersion: string; rolloutPercent: number }`
  - `readRolloutSettings(): Promise<RolloutSettings>`
  - `writeRolloutSettings(patch: Partial<RolloutSettings>): Promise<void>`

- [ ] **Step 1 : écrire le test**

Créer `apps/dashboard/lib/agent/__tests__/rollout-settings.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const getAllSettings = vi.fn()
const upsertSetting = vi.fn()

vi.mock('@/lib/db/queries', () => ({
	getAllSettings: () => getAllSettings(),
	upsertSetting: (...a: unknown[]) => upsertSetting(...a),
}))
vi.mock('@/lib/agent/payload', () => ({ readAgentVersion: async () => '1.1.0' }))

import { readRolloutSettings, writeRolloutSettings } from '@/lib/agent/rollout-settings'

afterEach(() => {
	getAllSettings.mockReset()
	upsertSetting.mockReset()
})

describe('readRolloutSettings', () => {
	it('falls back to the deployed version and a closed rollout', async () => {
		getAllSettings.mockResolvedValue({})
		expect(await readRolloutSettings()).toEqual({ targetVersion: '1.1.0', rolloutPercent: 0 })
	})

	it('reads the stored values', async () => {
		getAllSettings.mockResolvedValue({
			'agent.targetVersion': '1.0.0',
			'agent.rolloutPercent': '25',
		})
		expect(await readRolloutSettings()).toEqual({ targetVersion: '1.0.0', rolloutPercent: 25 })
	})

	it('clamps a nonsense percentage rather than deploying to a negative fleet', async () => {
		getAllSettings.mockResolvedValue({ 'agent.rolloutPercent': '512' })
		expect((await readRolloutSettings()).rolloutPercent).toBe(100)
		getAllSettings.mockResolvedValue({ 'agent.rolloutPercent': '-4' })
		expect((await readRolloutSettings()).rolloutPercent).toBe(0)
		getAllSettings.mockResolvedValue({ 'agent.rolloutPercent': 'beaucoup' })
		expect((await readRolloutSettings()).rolloutPercent).toBe(0)
	})
})

describe('writeRolloutSettings', () => {
	it('writes only the keys it was given', async () => {
		await writeRolloutSettings({ rolloutPercent: 50 })
		expect(upsertSetting).toHaveBeenCalledTimes(1)
		expect(upsertSetting).toHaveBeenCalledWith('agent.rolloutPercent', '50')
	})

	it('writes both when both are given', async () => {
		await writeRolloutSettings({ targetVersion: '1.0.0', rolloutPercent: 100 })
		expect(upsertSetting).toHaveBeenCalledWith('agent.targetVersion', '1.0.0')
		expect(upsertSetting).toHaveBeenCalledWith('agent.rolloutPercent', '100')
	})
})
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/rollout-settings.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : ajouter `readAgentVersion` à `payload.ts`**

À la fin de `apps/dashboard/lib/agent/payload.ts` :

```ts
// La version du déploiement ne change pas d'une requête à l'autre au sein d'un
// même processus : elle est lue une fois. `readAgentPayload()` charge 80 Ko de
// Python, ce qu'on ne veut pas faire à chaque interrogation de chaque box.
let cachedVersion: string | null = null

/**
 * Version embarquée par ce déploiement. Passer `dirs` court-circuite le cache —
 * réservé aux tests, qui pointent vers des dossiers temporaires et ne doivent
 * pas se contaminer entre eux.
 */
export async function readAgentVersion(dirs?: AgentPayloadDirs): Promise<string> {
	if (dirs) return (await readAgentFile('VERSION', dirs)).trim()
	if (cachedVersion === null) {
		cachedVersion = (await readAgentFile('VERSION', defaultDirs())).trim()
	}
	return cachedVersion
}
```

- [ ] **Step 4 : écrire `rollout-settings.ts`**

```ts
import { readAgentVersion } from '@/lib/agent/payload'
import { getAllSettings, upsertSetting } from '@/lib/db/queries'

export const TARGET_VERSION_KEY = 'agent.targetVersion'
export const ROLLOUT_PERCENT_KEY = 'agent.rolloutPercent'

export type RolloutSettings = {
	/** Version que le parc doit exécuter. Par défaut, celle du déploiement. */
	targetVersion: string
	/** Part des box `stable` à qui la cible est annoncée. Fermé par défaut. */
	rolloutPercent: number
}

/**
 * Les deux réglages de déploiement, avec leurs défauts.
 *
 * `getAllSettings()` lit toute la table : elle compte quelques dizaines de
 * lignes, et un balayage y coûte moins qu'une abstraction de cache de plus sur
 * un chemin déjà court.
 */
export async function readRolloutSettings(): Promise<RolloutSettings> {
	const [rows, deployed] = await Promise.all([getAllSettings(), readAgentVersion()])
	return {
		targetVersion: rows[TARGET_VERSION_KEY]?.trim() || deployed,
		rolloutPercent: clampPercent(rows[ROLLOUT_PERCENT_KEY]),
	}
}

export async function writeRolloutSettings(patch: Partial<RolloutSettings>): Promise<void> {
	if (patch.targetVersion !== undefined) {
		await upsertSetting(TARGET_VERSION_KEY, patch.targetVersion)
	}
	if (patch.rolloutPercent !== undefined) {
		await upsertSetting(ROLLOUT_PERCENT_KEY, String(clampPercent(String(patch.rolloutPercent))))
	}
}

/** Une valeur illisible vaut 0 : le défaut sûr est « personne ne bascule ». */
function clampPercent(raw: string | undefined): number {
	const n = Number.parseInt(raw ?? '', 10)
	if (Number.isNaN(n)) return 0
	return Math.min(100, Math.max(0, n))
}
```

- [ ] **Step 5 : lancer le test, vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/rollout-settings.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6 : lint et commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
git add apps/dashboard/lib/agent/rollout-settings.ts apps/dashboard/lib/agent/payload.ts apps/dashboard/lib/agent/__tests__/rollout-settings.test.ts
git commit -m "feat(agent): add the target-version and rollout-percent settings"
```

---

### Task 5 : la boucle de commandes annonce la cible

**Files:**
- Create: `apps/dashboard/lib/db/agent-rollout-queries.ts`
- Modify: `apps/dashboard/app/api/agent/commands/route.ts`
- Test: `apps/dashboard/app/api/agent/commands/__tests__/route.test.ts` (existant — y ajouter des cas)

**Interfaces:**
- Consumes: `resolveTargetVersion` (Task 1), `readRolloutSettings` (Task 4), `getAgentVersion` (Task 3).
- Produces: `readAgentChannel(db: DB, recalboxId: string): Promise<AgentChannel>` — `'stable'` quand la box est inconnue ou la valeur illisible.

- [ ] **Step 1 : écrire `agent-rollout-queries.ts`**

```ts
import type { AgentChannel } from '@/lib/agent/rollout'
import type { DB } from '@/lib/db'
import { recalboxes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Canal de déploiement d'une box. Une lecture par clé primaire, ajoutée à la
 * boucle de commandes : c'est la seule requête que ce mécanisme ajoute au
 * chemin de réponse, et `stable` est le défaut sûr en cas de doute.
 */
export async function readAgentChannel(db: DB, recalboxId: string): Promise<AgentChannel> {
	const row = await db
		.select({ channel: recalboxes.agentChannel })
		.from(recalboxes)
		.where(eq(recalboxes.id, recalboxId))
		.get()
	return row?.channel === 'beta' ? 'beta' : 'stable'
}
```

- [ ] **Step 2 : ajouter les cas de test à la route**

Dans `apps/dashboard/app/api/agent/commands/__tests__/route.test.ts`, ajouter les mocks en tête du fichier (à côté des existants) :

```ts
const readAgentChannel = vi.fn()
const readRolloutSettings = vi.fn()

vi.mock('@/lib/db/agent-rollout-queries', () => ({
	readAgentChannel: (...a: unknown[]) => readAgentChannel(...a),
}))
vi.mock('@/lib/agent/rollout-settings', () => ({
	readRolloutSettings: () => readRolloutSettings(),
}))
```

Remplacer l'aide `req` par une version qui porte aussi l'en-tête de version :

```ts
function req(auth: string | undefined, version?: string) {
	return {
		headers: {
			get: (k: string) => {
				const key = k.toLowerCase()
				if (key === 'authorization') return auth ?? null
				if (key === 'x-agent-version') return version ?? null
				return null
			},
		},
	}
}
```

Ajouter au `afterEach` : `readAgentChannel.mockReset()` et `readRolloutSettings.mockReset()`. Puis les cas :

```ts
describe('GET /api/agent/commands — target version', () => {
	it('announces the target to a stable box inside the batch', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([])
		readAgentChannel.mockResolvedValue('stable')
		readRolloutSettings.mockResolvedValue({ targetVersion: '1.1.0', rolloutPercent: 100 })
		const res = await GET(req('Bearer x', '1.0.0') as never)
		const body = await res.json()
		expect(body.agent).toEqual({ target_version: '1.1.0' })
	})

	it('says nothing to a stable box outside the batch', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([])
		readAgentChannel.mockResolvedValue('stable')
		readRolloutSettings.mockResolvedValue({ targetVersion: '1.1.0', rolloutPercent: 0 })
		const res = await GET(req('Bearer x', '1.0.0') as never)
		const body = await res.json()
		expect(body.agent).toEqual({ target_version: null })
	})

	it('says nothing to an agent that never declared its version', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([])
		readAgentChannel.mockResolvedValue('stable')
		readRolloutSettings.mockResolvedValue({ targetVersion: '1.1.0', rolloutPercent: 100 })
		const res = await GET(req('Bearer x') as never)
		const body = await res.json()
		expect(body.agent).toEqual({ target_version: null })
	})

	it('still serves commands when the rollout lookup fails', async () => {
		// A box must keep receiving power/conf commands even if the rollout
		// machinery is broken: control is the older, more important promise.
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		claimPendingCommands.mockResolvedValue([{ id: 'c1', type: 'power', payload: {} }])
		readAgentChannel.mockRejectedValue(new Error('db down'))
		readRolloutSettings.mockResolvedValue({ targetVersion: '1.1.0', rolloutPercent: 100 })
		const res = await GET(req('Bearer x', '1.0.0') as never)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.commands).toHaveLength(1)
		expect(body.agent).toEqual({ target_version: null })
	})
})
```

Enfin, compléter le test existant `returns claimed commands flattened for the agent` : y ajouter `readAgentChannel.mockResolvedValue('stable')` et `readRolloutSettings.mockResolvedValue({ targetVersion: '1.0.0', rolloutPercent: 0 })`.

- [ ] **Step 3 : lancer les tests, vérifier qu'ils échouent**

Run: `cd apps/dashboard && pnpm exec vitest run app/api/agent/commands/__tests__/route.test.ts`
Expected: FAIL — `body.agent` vaut `undefined`.

- [ ] **Step 4 : brancher la résolution dans la route**

Remplacer le corps de `GET` dans `apps/dashboard/app/api/agent/commands/route.ts` :

```ts
import { getAgentVersion, getBearerToken } from '@/lib/agent/bearer'
import { resolveTargetVersion } from '@/lib/agent/rollout'
import { readRolloutSettings } from '@/lib/agent/rollout-settings'
import { db } from '@/lib/db'
import { claimPendingCommands } from '@/lib/db/agent-commands'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { readAgentChannel } from '@/lib/db/agent-rollout-queries'
import { logger } from '@/lib/logger'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Agent poll: returns pending commands for the token's Recalbox and atomically
// claims them so each is delivered once. Outbound from the box → NAT-friendly.
// It also carries the version this box must converge to — riding this existing
// round-trip rather than adding a second one, since each poll is a billed
// serverless invocation.
export async function GET(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })

	const currentVersion = getAgentVersion(req)
	const resolved = await resolveAgentToken(db, token, currentVersion)
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	const commands = await claimPendingCommands(db, resolved.recalboxId)
	return NextResponse.json({
		commands: commands.map((c) => ({ id: c.id, type: c.type, payload: c.payload ?? {} })),
		agent: { target_version: await targetFor(resolved.recalboxId, currentVersion) },
	})
}

/**
 * La cible de cette box, ou `null`. Une panne du mécanisme de déploiement ne
 * doit pas emporter la remontée des commandes : le contrôle à distance est la
 * promesse la plus ancienne et la plus importante de cette route.
 */
async function targetFor(recalboxId: string, currentVersion: string | null) {
	try {
		const [channel, settings] = await Promise.all([
			readAgentChannel(db, recalboxId),
			readRolloutSettings(),
		])
		return resolveTargetVersion({
			channel,
			recalboxId,
			currentVersion,
			targetVersion: settings.targetVersion,
			rolloutPercent: settings.rolloutPercent,
		})
	} catch (err) {
		logger.error('[agent] rollout resolution failed', err)
		return null
	}
}
```

- [ ] **Step 5 : lancer les tests, vérifier qu'ils passent**

Run: `cd apps/dashboard && pnpm exec vitest run app/api/agent/commands/__tests__/route.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6 : lint et commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
git add apps/dashboard/lib/db/agent-rollout-queries.ts apps/dashboard/app/api/agent/commands/
git commit -m "feat(agent): announce the target version on the command poll"
```

---

### Task 6 : `updater.py` — comparer et vérifier

Le module qui porte toute la logique de mise à jour côté box. Cette tâche pose le fichier et les deux fonctions qui ne touchent à rien : comparer deux versions, et refuser un paquet qui ne compile pas.

**Files:**
- Create: `agent/updater.py`
- Create: `agent/test_updater.py`

**Interfaces:**
- Consumes: rien (stdlib seule).
- Produces:
  - `BUNDLE_FILES = ("agent.py", "scan_roms.py", "launch.py", "updater.py", "VERSION")`
  - `GRACE_SEC = 600`, `SUPERVISED_ENV = "SR_AGENT_SUPERVISED"`
  - `compare_versions(a, b) -> int`
  - `read_version(agent_dir) -> str`
  - `verify_bundle(files: dict) -> bool`

- [ ] **Step 1 : écrire les tests**

Créer `agent/test_updater.py` :

```python
#!/usr/bin/env python3
"""Tests du mécanisme de mise à jour automatique.

Stdlib unittest only. From the repo root:

    python3 -m unittest discover -s agent -v
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import updater  # noqa: E402


def bundle(agent_src="x = 1\n", version="1.1.0\n"):
    """Un paquet complet et valide, que chaque test déforme à sa guise."""
    files = {name: "# ok\n" for name in updater.BUNDLE_FILES}
    files["agent.py"] = agent_src
    files["VERSION"] = version
    return files


class CompareVersionsTest(unittest.TestCase):
    def test_orders_numerically_not_lexicographically(self):
        self.assertGreater(updater.compare_versions("1.10.0", "1.9.0"), 0)
        self.assertLess(updater.compare_versions("1.9.0", "1.10.0"), 0)

    def test_equal_versions(self):
        self.assertEqual(updater.compare_versions("1.1.0", "1.1.0"), 0)

    def test_pads_missing_segments(self):
        self.assertEqual(updater.compare_versions("1.1", "1.1.0"), 0)
        self.assertGreater(updater.compare_versions("2", "1.9.9"), 0)

    def test_garbage_segment_reads_as_zero(self):
        self.assertEqual(updater.compare_versions("1.x.0", "1.0.0"), 0)
        self.assertEqual(updater.compare_versions(None, "0.0.0"), 0)

    def test_matches_the_server_side_rule(self):
        # The same table is asserted in lib/agent/__tests__/version.test.ts.
        # Two implementations, one rule — they must not drift.
        cases = [("1.10.0", "1.9.0", 1), ("1.9.0", "1.10.0", -1), ("1.1", "1.1.0", 0)]
        for a, b, expected in cases:
            got = updater.compare_versions(a, b)
            self.assertEqual((got > 0) - (got < 0), expected, "%s vs %s" % (a, b))


class ReadVersionTest(unittest.TestCase):
    def test_reads_and_strips(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "VERSION"), "w") as f:
                f.write("1.2.3\n")
            self.assertEqual(updater.read_version(d), "1.2.3")

    def test_missing_file_is_lowest_version(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(updater.read_version(d), "0.0.0")


class VerifyBundleTest(unittest.TestCase):
    def test_accepts_a_complete_valid_bundle(self):
        self.assertTrue(updater.verify_bundle(bundle()))

    def test_rejects_python_that_does_not_compile(self):
        # This is the whole point: a truncated download must never be swapped in.
        self.assertFalse(updater.verify_bundle(bundle(agent_src="def broken(:\n")))

    def test_rejects_a_bundle_missing_a_file(self):
        files = bundle()
        del files["scan_roms.py"]
        self.assertFalse(updater.verify_bundle(files))

    def test_rejects_a_non_dict(self):
        self.assertFalse(updater.verify_bundle(None))
        self.assertFalse(updater.verify_bundle([]))

    def test_rejects_a_non_string_entry(self):
        files = bundle()
        files["launch.py"] = 42
        self.assertFalse(updater.verify_bundle(files))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `python3 -m unittest discover -s agent -v 2>&1 | tail -20`
Expected: FAIL — `ModuleNotFoundError: No module named 'updater'`.

- [ ] **Step 3 : écrire `agent/updater.py`**

```python
#!/usr/bin/env python3
"""Mise a jour automatique de l'agent Super-Retrogamers.

Sans dependance : RecalboxOS ne fournit que Python 3 et paho-mqtt.

Ce module porte TOUTE la logique de mise a jour. agent.py s'en sert pour le
chemin avant (telecharger, verifier, basculer, confirmer), launch.py pour le
retour arriere. Il vit ici plutot que dans le script bash du lanceur parce que
du bash sur une box distante n'est pas testable — et parce que le lanceur, lui,
n'est jamais mis a jour : sa corruption serait le seul echec irrattrapable.
"""

import json
import os
import py_compile
import shutil
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))

# Les fichiers remplaces par une mise a jour. Jamais config.json : il porte le
# jeton de la box. Jamais le lanceur userscripts/ : il reste gele.
BUNDLE_FILES = ("agent.py", "scan_roms.py", "launch.py", "updater.py", "VERSION")

UPDATE_DIR = ".update"
BACKUP_DIR = "backup"
WITNESS_NAME = "update.json"
FAILED_NAME = "failed.json"

# Le lanceur se declenche a CHAQUE navigation dans les menus. Sans ce delai, une
# navigation dix secondes apres la bascule verrait un temoin non confirme et
# annulerait une mise a jour parfaitement saine, pendant qu'elle tourne.
GRACE_SEC = 600

# Posee par launch.py avant son execv. agent.py ne se met a jour que s'il la
# voit : une box lancee par l'ancien custom.sh, sans superviseur, n'a personne
# pour la reparer si la nouvelle version ne demarre pas.
SUPERVISED_ENV = "SR_AGENT_SUPERVISED"


def _segment(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def compare_versions(a, b):
    """Negatif si a < b, 0 si egales, positif si a > b.

    Une comparaison de chaines classerait `1.10.0` AVANT `1.9.0` : c'est
    exactement l'erreur qui ferait descendre une box en croyant la monter. Un
    segment illisible vaut 0 plutot qu'une exception — la valeur vient du
    reseau, et lever ici couperait la boucle de commandes.
    """
    pa = str(a or "").split(".")
    pb = str(b or "").split(".")
    for i in range(max(len(pa), len(pb))):
        na = _segment(pa[i]) if i < len(pa) else 0
        nb = _segment(pb[i]) if i < len(pb) else 0
        if na != nb:
            return -1 if na < nb else 1
    return 0


def read_version(agent_dir=HERE):
    """Version presente dans un dossier. `0.0.0` si le fichier manque, ce qui
    fait perdre toute comparaison a un dossier incomplet."""
    try:
        with open(os.path.join(agent_dir, "VERSION"), "r") as f:
            return f.read().strip() or "0.0.0"
    except OSError:
        return "0.0.0"


def verify_bundle(files):
    """True si le paquet est complet et que chaque .py compile.

    py_compile attrape un telechargement tronque ou corrompu SANS rien
    executer. C'est la seule barriere entre un octet perdu sur le reseau et un
    agent qui ne redemarre plus.
    """
    if not isinstance(files, dict):
        return False
    for name in BUNDLE_FILES:
        if not isinstance(files.get(name), str):
            return False
    tmp = tempfile.mkdtemp(prefix="sr-agent-verify-")
    try:
        for name in BUNDLE_FILES:
            if not name.endswith(".py"):
                continue
            path = os.path.join(tmp, name)
            with open(path, "w") as f:
                f.write(files[name])
            try:
                py_compile.compile(path, cfile=path + "c", doraise=True)
            except (py_compile.PyCompileError, SyntaxError, ValueError, OSError):
                return False
        return True
    except OSError:
        return False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `cd /home/madjid/projets/recalbox-dashboard && python3 -m unittest discover -s agent -v 2>&1 | tail -20`
Expected: OK, tous les tests passent (y compris les anciens de `test_agent.py`).

- [ ] **Step 5 : commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
git add agent/updater.py agent/test_updater.py
git commit -m "feat(agent): add the updater module with version compare and bundle verification"
```

---

### Task 7 : `updater.py` — basculer, témoigner, restaurer

**Files:**
- Modify: `agent/updater.py`
- Modify: `agent/test_updater.py`

**Interfaces:**
- Consumes: `BUNDLE_FILES`, `verify_bundle`, `read_version`, `GRACE_SEC` (Task 6).
- Produces:
  - `stage_and_swap(agent_dir, files, from_version, to_version, now=None) -> bool`
  - `read_witness(agent_dir) -> dict | None`, `confirm_update(agent_dir) -> bool`, `clear_witness(agent_dir) -> None`
  - `pending_rollback(agent_dir, now=None, grace=GRACE_SEC) -> bool`
  - `rollback(agent_dir) -> bool` — restaure ET inscrit la version fautive
  - `restore_backup(agent_dir) -> bool` — restaure sans rien inscrire (descente voulue)
  - `backup_version(agent_dir) -> str | None`
  - `read_failed(agent_dir) -> list[str]`, `mark_failed(agent_dir, version) -> None`, `has_failed(agent_dir, version) -> bool`

- [ ] **Step 1 : écrire les tests**

Ajouter à `agent/test_updater.py`, avant le `if __name__` final :

```python
class SwapTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-swap-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")
        with open(os.path.join(self.dir, "VERSION"), "w") as f:
            f.write("1.0.0\n")

    def read(self, *parts):
        with open(os.path.join(self.dir, *parts), "r") as f:
            return f.read()

    def test_swaps_the_files_and_keeps_the_old_ones(self):
        self.assertTrue(
            updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        )
        self.assertEqual(self.read("agent.py"), "# new\n")
        self.assertEqual(self.read("VERSION"), "1.1.0\n")
        self.assertEqual(self.read(updater.BACKUP_DIR, "agent.py"), "# old\n")
        self.assertEqual(updater.backup_version(self.dir), "1.0.0")

    def test_refuses_a_bundle_that_does_not_compile_and_touches_nothing(self):
        self.assertFalse(
            updater.stage_and_swap(self.dir, bundle(agent_src="def x(:\n"), "1.0.0", "1.1.0")
        )
        self.assertEqual(self.read("agent.py"), "# old\n")
        self.assertIsNone(updater.read_witness(self.dir))

    def test_leaves_no_staging_directory_behind(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        self.assertFalse(os.path.exists(os.path.join(self.dir, updater.UPDATE_DIR)))

    def test_writes_the_witness_before_swapping(self):
        # os.replace is atomic per file, not across the set: a power cut mid-swap
        # leaves a mix of both versions. With the witness already on disk,
        # launch.py repairs it; written after, nothing would know.
        witness_seen = {}
        real_replace = os.replace

        def spy(src, dst):
            witness_seen.setdefault("at_first_replace", updater.read_witness(self.dir))
            return real_replace(src, dst)

        with mock.patch.object(os, "replace", spy):
            updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        self.assertIsNotNone(witness_seen["at_first_replace"])
        self.assertFalse(witness_seen["at_first_replace"]["confirmed"])


class WitnessTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-witness-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")

    def test_no_witness_means_nothing_to_roll_back(self):
        self.assertFalse(updater.pending_rollback(self.dir))

    def test_a_fresh_witness_is_given_time(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0", now=1000)
        self.assertFalse(updater.pending_rollback(self.dir, now=1000 + 10))

    def test_an_unconfirmed_witness_expires(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0", now=1000)
        self.assertTrue(updater.pending_rollback(self.dir, now=1000 + updater.GRACE_SEC))

    def test_a_confirmed_witness_never_expires(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0", now=1000)
        self.assertTrue(updater.confirm_update(self.dir))
        self.assertFalse(updater.pending_rollback(self.dir, now=1000 + 10 * updater.GRACE_SEC))

    def test_confirming_twice_is_a_no_op(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        self.assertTrue(updater.confirm_update(self.dir))
        self.assertFalse(updater.confirm_update(self.dir))

    def test_an_unreadable_witness_is_treated_as_failed(self):
        with open(os.path.join(self.dir, updater.WITNESS_NAME), "w") as f:
            f.write("{ not json")
        self.assertFalse(updater.pending_rollback(self.dir))


class RollbackTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-rollback-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")
        with open(os.path.join(self.dir, "VERSION"), "w") as f:
            f.write("1.0.0\n")

    def read(self, name):
        with open(os.path.join(self.dir, name), "r") as f:
            return f.read()

    def test_restores_the_previous_files_and_version(self):
        updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        self.assertTrue(updater.rollback(self.dir))
        self.assertEqual(self.read("agent.py"), "# old\n")
        self.assertEqual(self.read("VERSION"), "1.0.0\n")
        self.assertIsNone(updater.read_witness(self.dir))

    def test_records_the_failing_version_so_it_is_not_retried(self):
        # Without this the box restores 1.0.0, polls 60s later, finds 1.1.0
        # again, re-downloads it, re-crashes — forever.
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        updater.rollback(self.dir)
        self.assertTrue(updater.has_failed(self.dir, "1.1.0"))
        self.assertFalse(updater.has_failed(self.dir, "1.1.1"))

    def test_rollback_without_a_backup_clears_the_witness(self):
        with open(os.path.join(self.dir, updater.WITNESS_NAME), "w") as f:
            f.write('{"from": "1.0.0", "to": "1.1.0", "at": 1, "confirmed": false}')
        self.assertFalse(updater.rollback(self.dir))
        self.assertIsNone(updater.read_witness(self.dir))

    def test_restore_backup_does_not_blame_the_version(self):
        # A deliberate descent ordered by the cloud is not a failure: marking it
        # would make the box refuse the very version it was told to run.
        updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        updater.clear_witness(self.dir)
        self.assertTrue(updater.restore_backup(self.dir))
        self.assertEqual(self.read("agent.py"), "# old\n")
        self.assertEqual(updater.read_failed(self.dir), [])

    def test_failed_ledger_survives_garbage(self):
        with open(os.path.join(self.dir, updater.FAILED_NAME), "w") as f:
            f.write("not json at all")
        self.assertEqual(updater.read_failed(self.dir), [])
        updater.mark_failed(self.dir, "1.1.0")
        self.assertEqual(updater.read_failed(self.dir), ["1.1.0"])
```

Ajouter `import shutil` et `from unittest import mock` aux imports du fichier de test.

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `cd /home/madjid/projets/recalbox-dashboard && python3 -m unittest discover -s agent 2>&1 | tail -20`
Expected: FAIL — `module 'updater' has no attribute 'stage_and_swap'`.

- [ ] **Step 3 : compléter `agent/updater.py`**

Ajouter à la fin du fichier :

```python
def _witness_path(agent_dir):
    return os.path.join(agent_dir, WITNESS_NAME)


def _failed_path(agent_dir):
    return os.path.join(agent_dir, FAILED_NAME)


def _backup_path(agent_dir):
    return os.path.join(agent_dir, BACKUP_DIR)


def _write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f)


def read_witness(agent_dir):
    """Le temoin de bascule, ou None s'il n'existe pas ou est illisible."""
    try:
        with open(_witness_path(agent_dir), "r") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def clear_witness(agent_dir):
    try:
        os.remove(_witness_path(agent_dir))
    except OSError:
        pass


def backup_version(agent_dir):
    """Version conservee dans backup/, ou None s'il n'y a pas de sauvegarde."""
    try:
        with open(os.path.join(_backup_path(agent_dir), "VERSION"), "r") as f:
            return f.read().strip() or None
    except OSError:
        return None


def stage_and_swap(agent_dir, files, from_version, to_version, now=None):
    """Verifie le paquet, sauvegarde l'existant, pose le temoin, bascule.

    Retourne True si la bascule a eu lieu. Aucun effet visible en cas d'echec de
    la verification : rien n'est touche tant que le paquet n'a pas compile.
    """
    if not verify_bundle(files):
        return False

    staging = os.path.join(agent_dir, UPDATE_DIR)
    shutil.rmtree(staging, ignore_errors=True)
    try:
        os.makedirs(staging)
        for name in BUNDLE_FILES:
            with open(os.path.join(staging, name), "w") as f:
                f.write(files[name])

        backup = _backup_path(agent_dir)
        shutil.rmtree(backup, ignore_errors=True)
        os.makedirs(backup)
        for name in BUNDLE_FILES:
            src = os.path.join(agent_dir, name)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(backup, name))

        # Le temoin AVANT l'echange, jamais apres. os.replace est atomique
        # fichier par fichier, pas sur l'ensemble : une coupure de courant au
        # milieu laisse un melange des deux versions. Avec le temoin deja pose,
        # launch.py le repare ; pose apres, ce melange n'en porterait aucun et
        # la box resterait cassee sans que rien ne le sache.
        _write_json(
            _witness_path(agent_dir),
            {
                "from": from_version,
                "to": to_version,
                "at": int(now if now is not None else time.time()),
                "confirmed": False,
            },
        )

        for name in BUNDLE_FILES:
            os.replace(os.path.join(staging, name), os.path.join(agent_dir, name))
        return True
    except OSError:
        return False
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def confirm_update(agent_dir):
    """Marque le temoin confirme. True si ce marquage vient d'avoir lieu.

    Appele au premier aller-retour reussi avec le cloud : c'est la preuve la
    moins chere que cette version parle.
    """
    witness = read_witness(agent_dir)
    if not witness or witness.get("confirmed"):
        return False
    witness["confirmed"] = True
    try:
        _write_json(_witness_path(agent_dir), witness)
        return True
    except OSError:
        return False


def pending_rollback(agent_dir, now=None, grace=GRACE_SEC):
    """True quand une bascule n'a jamais fait ses preuves et a epuise son delai."""
    witness = read_witness(agent_dir)
    if not witness or witness.get("confirmed"):
        return False
    at = witness.get("at")
    if not isinstance(at, (int, float)):
        # Temoin illisible : on ne sait pas quand la bascule a eu lieu, donc on
        # ne peut pas lui accorder de delai. Restaurer est le choix sur.
        return True
    return (now if now is not None else time.time()) - at >= grace


def _copy_from_backup(agent_dir):
    backup = _backup_path(agent_dir)
    if not os.path.isdir(backup):
        return False
    try:
        for name in BUNDLE_FILES:
            src = os.path.join(backup, name)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(agent_dir, name))
        return True
    except OSError:
        return False


def restore_backup(agent_dir):
    """Restaure la sauvegarde SANS blamer la version courante.

    Le chemin d'une descente voulue par le cloud : cette version n'a pas
    echoue, on la redescend volontairement. L'inscrire au journal des echecs
    ferait refuser a la box la version qu'on vient de lui demander d'executer.
    """
    return _copy_from_backup(agent_dir)


def rollback(agent_dir):
    """Restaure la sauvegarde ET inscrit la version fautive au journal.

    Le chemin d'une bascule qui n'a jamais parle au cloud.
    """
    witness = read_witness(agent_dir) or {}
    failed_version = witness.get("to")
    ok = _copy_from_backup(agent_dir)
    if ok and failed_version:
        mark_failed(agent_dir, failed_version)
    clear_witness(agent_dir)
    return ok


def read_failed(agent_dir):
    """Versions qui ont deja echoue sur cette box. Liste vide si illisible."""
    try:
        with open(_failed_path(agent_dir), "r") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return [v for v in data if isinstance(v, str)] if isinstance(data, list) else []


def mark_failed(agent_dir, version):
    """Inscrit une version au journal des echecs. Sans ce journal, la box
    restaure, repolle, retrouve la meme cible et replante — indefiniment."""
    versions = read_failed(agent_dir)
    if version not in versions:
        versions.append(version)
    try:
        _write_json(_failed_path(agent_dir), versions[-10:])
    except OSError:
        pass


def has_failed(agent_dir, version):
    return version in read_failed(agent_dir)
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `cd /home/madjid/projets/recalbox-dashboard && python3 -m unittest discover -s agent 2>&1 | tail -10`
Expected: OK.

- [ ] **Step 5 : commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
git add agent/updater.py agent/test_updater.py
git commit -m "feat(agent): add the swap, witness, rollback and failed-version ledger"
```

---

### Task 8 : `updater.py` et `VERSION` voyagent dans le paquet et dans le zip

Sans cette tâche, une box fraîchement installée n'a ni `updater.py` ni `VERSION` — elle ne saurait ni quelle version elle exécute, ni comment se mettre à jour. **Les trois listes de fichiers doivent bouger ensemble** (voir les contraintes globales).

**Files:**
- Modify: `apps/dashboard/lib/agent/payload.ts`
- Modify: `apps/dashboard/lib/agent/installer-zip.ts`
- Modify: `apps/dashboard/scripts/copy-agent-payload.mjs`
- Modify: `apps/dashboard/next.config.ts`
- Modify: `apps/dashboard/app/api/recalboxes/[id]/installer/route.ts`
- Test: `apps/dashboard/lib/agent/__tests__/installer-zip.test.ts` (existant), `apps/dashboard/lib/agent/__tests__/payload.test.ts` (existant)

**Interfaces:**
- Consumes: `agent/updater.py` (Task 6/7).
- Produces: `AgentPayload` gagne `updaterPy: string` ; `InstallerInput` gagne `updaterPy: string` et `version: string`.

- [ ] **Step 1 : ajouter les cas de test au constructeur de zip**

Dans `apps/dashboard/lib/agent/__tests__/installer-zip.test.ts`, ajouter au cas qui vérifie l'arborescence (et compléter l'objet d'entrée des cas existants avec `updaterPy: '# updater\n'` et `version: '1.1.0'`) :

```ts
	it('ships the updater and the version file next to the agent', () => {
		// Without these two, a freshly installed box knows neither which version
		// it runs nor how to move to another one — auto-update never starts.
		const zip = unzipSync(buildInstallerZip(input()))
		expect(strFromU8(entry(zip, 'system/sr-agent/updater.py'))).toBe('# updater\n')
		expect(strFromU8(entry(zip, 'system/sr-agent/VERSION'))).toBe('1.1.0\n')
	})
```

(Reprendre les aides `input()` et `entry()` déjà présentes dans ce fichier ; si elles portent d'autres noms, s'aligner sur l'existant.)

- [ ] **Step 2 : ajouter `updater.py` au test du paquet**

Dans `apps/dashboard/lib/agent/__tests__/payload.test.ts`, ajouter `'updater.py'` à la liste `requiredFiles` (ligne 30) et écrire le fichier correspondant dans le dossier temporaire à côté des autres (ligne 39 environ).

- [ ] **Step 3 : lancer les tests, vérifier qu'ils échouent**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/installer-zip.test.ts lib/agent/__tests__/payload.test.ts`
Expected: FAIL — entrées absentes du zip.

- [ ] **Step 4 : lire `updater.py` dans le paquet**

Dans `apps/dashboard/lib/agent/payload.ts`, ajouter `updaterPy: string` au type `AgentPayload`, puis dans `readAgentPayload` :

```ts
	const [agentPy, scanRomsPy, launchPy, updaterPy, launcherSh, version] = await Promise.all([
		readAgentFile('agent.py', dirs),
		readAgentFile('scan_roms.py', dirs),
		readAgentFile('launch.py', dirs),
		readAgentFile('updater.py', dirs),
		readAgentFile('sr-agent[systembrowsing].sh', dirs),
		readAgentFile('VERSION', dirs),
	])
	return { agentPy, scanRomsPy, launchPy, updaterPy, launcherSh, version: version.trim() }
```

- [ ] **Step 5 : ajouter les deux fichiers au zip**

Dans `apps/dashboard/lib/agent/installer-zip.ts`, ajouter `updaterPy: string` et `version: string` à `InstallerInput`, puis dans `zipSync` :

```ts
			[`${AGENT_DIR}/launch.py`]: strToU8(input.launchPy),
			[`${AGENT_DIR}/updater.py`]: strToU8(input.updaterPy),
			// La box doit savoir quelle version elle execute : c'est ce que le
			// cloud compare a la cible qu'il lui annonce.
			[`${AGENT_DIR}/VERSION`]: strToU8(`${input.version}\n`),
```

- [ ] **Step 6 : passer les deux champs depuis la route d'installation**

Dans `apps/dashboard/app/api/recalboxes/[id]/installer/route.ts`, ajouter `updaterPy: payload.updaterPy` et `version: payload.version` à l'objet passé à `buildInstallerZip`.

- [ ] **Step 7 : synchroniser les deux autres listes**

Dans `apps/dashboard/scripts/copy-agent-payload.mjs` :

```js
const FILES = [
	'agent.py',
	'scan_roms.py',
	'launch.py',
	'updater.py',
	'sr-agent[systembrowsing].sh',
	'VERSION',
]
```

Dans `apps/dashboard/next.config.ts`, ajouter `'agent-payload/updater.py'` à la liste de la route `'/api/recalboxes/[id]/installer'`.

- [ ] **Step 8 : lancer les tests, vérifier qu'ils passent**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/ && pnpm exec tsc --noEmit`
Expected: PASS des deux côtés.

- [ ] **Step 9 : vérifier que le script de copie fait bien son travail**

Run: `cd apps/dashboard && node scripts/copy-agent-payload.mjs`
Expected: la ligne affichée mentionne **6 fichiers**, dont `updater.py`, avec des tailles non nulles.

- [ ] **Step 10 : lint et commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
git add apps/dashboard/lib/agent/ apps/dashboard/scripts/copy-agent-payload.mjs apps/dashboard/next.config.ts apps/dashboard/app/api/recalboxes/
git commit -m "feat(agent): ship updater.py and VERSION in the installer payload"
```

---

### Task 9 : `GET /api/agent/download`

**Files:**
- Create: `apps/dashboard/app/api/agent/download/route.ts`
- Create: `apps/dashboard/app/api/agent/download/__tests__/route.test.ts`
- Modify: `apps/dashboard/next.config.ts`

**Interfaces:**
- Consumes: `readAgentPayload` (Task 8), `resolveAgentToken`, `getAgentVersion` (Task 3).
- Produces: la réponse `{ version: string, files: Record<string, string> }` que `agent.py` consomme en Task 10.

- [ ] **Step 1 : écrire le test**

Créer `apps/dashboard/app/api/agent/download/__tests__/route.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveAgentToken = vi.fn()
const readAgentPayload = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	resolveAgentToken: (...a: unknown[]) => resolveAgentToken(...a),
}))
vi.mock('@/lib/agent/payload', () => ({
	readAgentPayload: () => readAgentPayload(),
}))

import { GET } from '../route'

function req(auth: string | undefined) {
	return {
		headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? (auth ?? null) : null) },
	}
}

afterEach(() => {
	resolveAgentToken.mockReset()
	readAgentPayload.mockReset()
})

describe('GET /api/agent/download', () => {
	it('401s without a token', async () => {
		expect((await GET(req(undefined) as never)).status).toBe(401)
	})

	it('401s on an invalid token', async () => {
		resolveAgentToken.mockResolvedValue(null)
		expect((await GET(req('Bearer x') as never)).status).toBe(401)
	})

	it('serves the deployed bundle to a valid token', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		readAgentPayload.mockResolvedValue({
			agentPy: '# agent',
			scanRomsPy: '# scan',
			launchPy: '# launch',
			updaterPy: '# updater',
			launcherSh: '# sh',
			version: '1.1.0',
		})
		const res = await GET(req('Bearer x') as never)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.version).toBe('1.1.0')
		expect(Object.keys(body.files).sort()).toEqual([
			'VERSION',
			'agent.py',
			'launch.py',
			'scan_roms.py',
			'updater.py',
		])
		// The launcher is deliberately absent: it is the one file whose
		// corruption is unrecoverable, so it is never auto-updated.
		expect(body.files['sr-agent[systembrowsing].sh']).toBeUndefined()
		expect(body.files.VERSION).toBe('1.1.0\n')
	})

	it('never lets a bundle be cached', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		readAgentPayload.mockResolvedValue({
			agentPy: '',
			scanRomsPy: '',
			launchPy: '',
			updaterPy: '',
			launcherSh: '',
			version: '1.1.0',
		})
		const res = await GET(req('Bearer x') as never)
		expect(res.headers.get('cache-control')).toContain('no-store')
	})

	it('500s rather than serving half a bundle', async () => {
		resolveAgentToken.mockResolvedValue({ recalboxId: 'rb1', tokenId: 't1' })
		readAgentPayload.mockRejectedValue(new Error('ENOENT'))
		expect((await GET(req('Bearer x') as never)).status).toBe(500)
	})
})
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run app/api/agent/download/__tests__/route.test.ts`
Expected: FAIL — `../route` introuvable.

- [ ] **Step 3 : écrire la route**

```ts
import { getAgentVersion, getBearerToken } from '@/lib/agent/bearer'
import { readAgentPayload } from '@/lib/agent/payload'
import { db } from '@/lib/db'
import { resolveAgentToken } from '@/lib/db/agent-queries'
import { logger } from '@/lib/logger'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Sert le paquet de l'agent embarque par CE deploiement — le seul dont le cloud
 * dispose. Une box qui veut redescendre d'une version restaure sa propre
 * sauvegarde locale et ne passe jamais par ici.
 *
 * Le lanceur `userscripts/` est volontairement absent du paquet : c'est le seul
 * fichier dont la corruption serait irrattrapable.
 */
export async function GET(req: NextRequest) {
	const token = getBearerToken(req)
	if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })

	const resolved = await resolveAgentToken(db, token, getAgentVersion(req))
	if (!resolved) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

	try {
		const payload = await readAgentPayload()
		return NextResponse.json(
			{
				version: payload.version,
				files: {
					'agent.py': payload.agentPy,
					'scan_roms.py': payload.scanRomsPy,
					'launch.py': payload.launchPy,
					'updater.py': payload.updaterPy,
					VERSION: `${payload.version}\n`,
				},
			},
			{ headers: { 'Cache-Control': 'no-store' } },
		)
	} catch (err) {
		// Mieux vaut un 500 qu'un paquet incomplet : l'agent verifie ce qu'il
		// recoit, mais un paquet amputé d'un fichier passerait la compilation.
		logger.error('[agent] download payload read failed', err)
		return NextResponse.json({ error: 'payload_unavailable' }, { status: 500 })
	}
}
```

- [ ] **Step 4 : déclarer la route au traceur de fichiers**

Dans `apps/dashboard/next.config.ts`, ajouter une entrée à `outputFileTracingIncludes`, à côté de celle de l'installeur :

```ts
		// Même mécanisme que la route d'installation ci-dessus : sans cette
		// déclaration, `agent-payload/` n'entre pas dans le build standalone et
		// la route 500 en production sans avoir échoué au build.
		'/api/agent/download': [
			'agent-payload/agent.py',
			'agent-payload/scan_roms.py',
			'agent-payload/launch.py',
			'agent-payload/updater.py',
			'agent-payload/VERSION',
		],
```

- [ ] **Step 5 : lancer le test, vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run app/api/agent/download/__tests__/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6 : lint et commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
git add apps/dashboard/app/api/agent/download/ apps/dashboard/next.config.ts
git commit -m "feat(agent): serve the deployed agent bundle to enrolled boxes"
```

---

### Task 10 : brancher la mise à jour dans `agent.py`

La tâche la plus délicate du plan. Elle contient le correctif du verrou décrit dans la spec, et le test qui l'attrape.

**Files:**
- Modify: `agent/agent.py`
- Modify: `agent/test_updater.py`

**Interfaces:**
- Consumes: tout `updater` (Tasks 6-7).
- Produces: `agent.AGENT_VERSION`, `agent.LOCK_FD`, `agent.restart()`, `agent.is_busy(tracker)`, `agent.maybe_update(cfg, tracker, target)`, `agent.download_bundle(cfg)` ; `command_loop(cfg, tracker=None)`.

- [ ] **Step 1 : écrire le test du verrou et de l'`execv`**

C'est le seul test capable d'attraper le descripteur hérité : le comportement vient du noyau, aucune simulation ne le voit. Ajouter à `agent/test_updater.py` :

```python
LOCK_PROBE = '''
import fcntl, os, sys
lock = os.path.join(os.path.dirname(os.path.abspath(__file__)), "launch.lock")
fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o644)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    sys.stdout.write("ACQUIRED")
except OSError:
    sys.stdout.write("BLOCKED")
'''

PARENT = '''
import os, sys, types
_paho = types.ModuleType("paho")
_mqtt = types.ModuleType("paho.mqtt")
_client = types.ModuleType("paho.mqtt.client")
_client.Client = object
_paho.mqtt = _mqtt
_mqtt.client = _client
sys.modules["paho"] = _paho
sys.modules["paho.mqtt"] = _mqtt
sys.modules["paho.mqtt.client"] = _client

sys.path.insert(0, %(agent_dir)r)
import agent
agent.HERE = %(tmp)r
acquired, fd = agent.acquire_lock()
assert acquired, "the parent must own the lock before restarting"
agent.LOCK_FD = fd
%(extra)s
agent.restart()
'''


class RestartLockTest(unittest.TestCase):
    """Le piege que ce test existe pour attraper.

    acquire_lock() rend le descripteur heritable : il survit a execv en tenant
    toujours LOCK_EX. Le nouvel agent ouvre un descripteur NEUF sur le meme
    fichier et flock() arbitre entre descriptions de fichier ouvert, pas entre
    processus — il se refuserait donc le verrou a lui-meme. Sans le close()
    dans restart(), TOUTES les mises a jour echoueraient.
    """

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-execv-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.agent_dir = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(self.dir, "agent.py"), "w") as f:
            f.write(LOCK_PROBE)

    def run_parent(self, extra=""):
        script = os.path.join(self.dir, "parent.py")
        with open(script, "w") as f:
            f.write(PARENT % {"agent_dir": self.agent_dir, "tmp": self.dir, "extra": extra})
        out = subprocess.run(
            [sys.executable, script], capture_output=True, text=True, timeout=30
        )
        return out.stdout.strip()

    def test_the_restarted_agent_gets_the_lock(self):
        self.assertEqual(self.run_parent(), "ACQUIRED")

    def test_without_the_close_the_restarted_agent_would_be_locked_out(self):
        # Negative control: proves the close() in restart() is load-bearing and
        # not decoration. If this ever prints ACQUIRED, the lock is no longer
        # inherited and the comment in restart() has gone stale.
        self.assertEqual(self.run_parent(extra="agent.LOCK_FD = None"), "BLOCKED")
```

Ajouter `import subprocess` aux imports de `agent/test_updater.py`.

- [ ] **Step 2 : écrire les tests de décision**

Toujours dans `agent/test_updater.py` :

```python
class MaybeUpdateTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sr-agent-decide-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")
        with open(os.path.join(self.dir, "VERSION"), "w") as f:
            f.write("1.0.0\n")
        self.here = mock.patch.object(agent, "HERE", self.dir)
        self.here.start()
        self.addCleanup(self.here.stop)
        self.version = mock.patch.object(agent, "AGENT_VERSION", "1.0.0")
        self.version.start()
        self.addCleanup(self.version.stop)
        self.supervised = mock.patch.dict(
            os.environ, {updater.SUPERVISED_ENV: "1"}
        )
        self.supervised.start()
        self.addCleanup(self.supervised.stop)
        self.restart = mock.patch.object(agent, "restart")
        self.restart_mock = self.restart.start()
        self.addCleanup(self.restart.stop)

    def test_does_nothing_without_a_target(self):
        agent.maybe_update({}, None, None)
        self.restart_mock.assert_not_called()

    def test_does_nothing_when_already_on_target(self):
        agent.maybe_update({}, None, "1.0.0")
        self.restart_mock.assert_not_called()

    def test_refuses_to_update_without_a_supervisor(self):
        # A box on the old custom.sh path has nothing that would repair it if
        # the new version fails to start, so it must never update.
        with mock.patch.dict(os.environ, {updater.SUPERVISED_ENV: ""}):
            agent.maybe_update({}, None, "1.1.0")
        self.restart_mock.assert_not_called()

    def test_refuses_a_version_that_already_failed_here(self):
        updater.mark_failed(self.dir, "1.1.0")
        agent.maybe_update({}, None, "1.1.0")
        self.restart_mock.assert_not_called()

    def test_defers_while_a_session_is_open(self):
        tracker = types.SimpleNamespace(open={"rom_path": "/x.zip"})
        with mock.patch.object(agent, "download_bundle") as dl:
            agent.maybe_update({}, tracker, "1.1.0")
        dl.assert_not_called()
        self.restart_mock.assert_not_called()

    def test_descends_from_the_local_backup_without_downloading(self):
        updater.stage_and_swap(self.dir, bundle(version="1.1.0\n"), "1.0.0", "1.1.0")
        with mock.patch.object(agent, "AGENT_VERSION", "1.1.0"):
            with mock.patch.object(agent, "download_bundle") as dl:
                agent.maybe_update({}, None, "1.0.0")
        dl.assert_not_called()
        self.restart_mock.assert_called_once()

    def test_stays_put_when_the_backup_is_not_the_target(self):
        # The one-step limit made visible rather than silent.
        with mock.patch.object(agent, "AGENT_VERSION", "1.2.0"):
            agent.maybe_update({}, None, "0.9.0")
        self.restart_mock.assert_not_called()

    def test_swaps_and_restarts_on_a_valid_download(self):
        with mock.patch.object(
            agent, "download_bundle", return_value={"version": "1.1.0", "files": bundle()}
        ):
            agent.maybe_update({}, None, "1.1.0")
        self.restart_mock.assert_called_once()
        self.assertEqual(updater.read_version(self.dir), "1.1.0")

    def test_refuses_a_download_that_does_not_compile(self):
        broken = {"version": "1.1.0", "files": bundle(agent_src="def x(:\n")}
        with mock.patch.object(agent, "download_bundle", return_value=broken):
            agent.maybe_update({}, None, "1.1.0")
        self.restart_mock.assert_not_called()
        self.assertEqual(updater.read_version(self.dir), "1.0.0")
```

Ajouter `import types` aux imports du fichier de test, et importer le module agent avec le même préambule paho que `test_agent.py` (recopier les lignes 24-36 de `agent/test_agent.py`, puis `import agent`).

- [ ] **Step 3 : lancer les tests, vérifier qu'ils échouent**

Run: `python3 -m unittest discover -s agent 2>&1 | tail -20`
Expected: FAIL — `module 'agent' has no attribute 'maybe_update'`.

- [ ] **Step 4 : câbler `agent.py`**

Ajouter `import updater` avec les autres imports, puis juste après la définition de `HERE` (ligne 41) :

```python
AGENT_VERSION = updater.read_version(HERE)

# Descripteur du verrou d'exclusivite, garde pour toute la vie du processus et
# ferme AVANT tout execv (voir restart()).
LOCK_FD = None
```

Dans `http_post_json_outcome` et `http_get_json`, après `req.add_header("Authorization", ...)` (ou juste après la création de `req` pour le GET) :

```python
    req.add_header("X-Agent-Version", AGENT_VERSION)
```

Ajouter, avant `command_loop` :

```python
def download_bundle(cfg):
    """Recupere le paquet servi par le cloud. None si indisponible ou malforme."""
    data = http_get_json(
        endpoint_for(cfg, "download"), cfg.get("token"), cfg.get("http_timeout_sec", 10)
    )
    if not isinstance(data, dict):
        return None
    files = data.get("files")
    version = data.get("version")
    if not isinstance(files, dict) or not isinstance(version, str):
        return None
    return {"version": version, "files": files}


def is_busy(tracker):
    """True tant qu'une partie ou un scan tourne.

    Se relancer au milieu d'une partie perdrait l'appairage debut/fin, donc la
    session que l'utilisateur est venu voir. Un execv au milieu d'un scan le
    perdrait entierement.
    """
    if tracker is not None and tracker.open:
        return True
    with _scan_lock:
        return _scan_running


def restart():
    """Se relance en place. Ne revient jamais.

    Sans execv, l'agent resterait mort jusqu'a ce que l'utilisateur retourne au
    menu — potentiellement des heures.
    """
    global LOCK_FD
    if LOCK_FD is not None:
        # OBLIGATOIRE. acquire_lock() rend le descripteur heritable : il
        # survivrait a execv en tenant toujours LOCK_EX, et le nouvel agent —
        # qui ouvre un descripteur NEUF sur le meme fichier — se refuserait le
        # verrou a lui-meme, car flock() arbitre entre descriptions de fichier
        # ouvert, pas entre processus. Toutes les mises a jour echoueraient.
        # Ne PAS transmettre le descripteur a la place : ce serait coupler
        # l'ancienne version et la nouvelle a une convention partagee, et une
        # version qui ne la connait pas ne demarrerait plus.
        try:
            os.close(LOCK_FD)
        except OSError:
            pass
        LOCK_FD = None
    os.execv(sys.executable, [sys.executable, os.path.join(HERE, "agent.py")])


def maybe_update(cfg, tracker, target):
    """Fait converger la box vers `target`. Ne revient pas si la bascule a lieu."""
    if not target or target == AGENT_VERSION:
        return
    if os.environ.get(updater.SUPERVISED_ENV) != "1":
        log.info("Target %s announced but this agent has no supervisor; not updating", target)
        return
    if updater.has_failed(HERE, target):
        log.info("Target %s already failed on this box; not retrying", target)
        return
    if is_busy(tracker):
        log.info("Update to %s deferred: a session or a rom scan is running", target)
        return

    if updater.compare_versions(target, AGENT_VERSION) < 0:
        # Le cloud ne dispose que de la version deployee, jamais des anciennes :
        # la seule source d'une descente est la sauvegarde locale.
        have = updater.backup_version(HERE)
        if have != target:
            log.warning("Cannot reach target %s: the local backup holds %s", target, have)
            return
        if updater.restore_backup(HERE):
            log.info("Restored %s from the local backup, restarting", target)
            restart()
        return

    bundle = download_bundle(cfg)
    if not bundle or bundle["version"] != target:
        log.warning("Download did not yield target %s", target)
        return
    if not updater.stage_and_swap(HERE, bundle["files"], AGENT_VERSION, target):
        log.error("Update to %s refused: the bundle did not verify", target)
        return
    log.info("Updated %s -> %s, restarting", AGENT_VERSION, target)
    restart()
```

Remplacer `command_loop` :

```python
def command_loop(cfg, tracker=None):
    """Poll the cloud for pending commands, execute them locally, report back.

    The same round-trip carries the version this box must run: each poll is a
    billed serverless invocation, so the update mechanism rides it rather than
    opening a second loop.
    """
    url = endpoint_for(cfg, "commands")
    result_url = (url + "/result") if url else ""
    interval = _int_cfg(cfg, "command_poll_interval_sec", 60)
    token = cfg.get("token")
    timeout = cfg.get("http_timeout_sec", 10)
    delay = interval
    while True:
        ok = False
        try:
            data = http_get_json(url, token, timeout)
            # The GET is the cloud round-trip; a command that fails to execute locally
            # says nothing about the cloud, so it must not slow the poll down.
            ok = data is not None
            if ok:
                # A successful round-trip is the cheapest possible proof that
                # this version talks to the cloud — which is exactly what the
                # rollback witness is waiting for.
                updater.confirm_update(HERE)
            for cmd in (data or {}).get("commands") or []:
                handle_command(cmd, result_url, token, timeout, cfg)
            if ok:
                agent_block = (data or {}).get("agent") or {}
                maybe_update(cfg, tracker, agent_block.get("target_version"))
        except Exception as e:  # never let the thread die
            log.error("command_loop error: %s", e)
        delay = next_retry_delay(delay, interval, ok)
        time.sleep(delay)
```

Dans `main()`, garder le descripteur et passer le tracker :

```python
    acquired, lock_fd = acquire_lock()
    if not acquired:
        log.info("Another agent instance already holds the lock, exiting")
        sys.exit(0)
    global LOCK_FD
    LOCK_FD = lock_fd
```

et

```python
    threading.Thread(target=command_loop, args=(cfg, tracker), daemon=True).start()
```

Enfin, compléter la ligne de démarrage pour que le journal de la box dise quelle version tourne :

```python
    log.info(
        "sr-agent %s starting (recalbox_id=%s, mqtt=%s:%s, cloud=%s)",
        AGENT_VERSION,
        cfg.get("recalbox_id"),
        …
```

**Attention** : `global LOCK_FD` doit apparaître avant toute utilisation dans `main()`, et `tracker` est défini plus bas dans `main()` que le démarrage des threads — vérifier que le thread de commandes démarre bien **après** `tracker = SessionTracker(...)` (c'est déjà le cas aujourd'hui).

- [ ] **Step 5 : lancer les tests, vérifier qu'ils passent**

Run: `cd /home/madjid/projets/recalbox-dashboard && timeout 120 python3 -m unittest discover -s agent 2>&1 | tail -10`
Expected: OK. **Le test de contrôle négatif doit afficher `BLOCKED`** — s'il affiche `ACQUIRED`, le `close()` de `restart()` n'est plus nécessaire et le commentaire est périmé : le signaler plutôt que supprimer le test.

- [ ] **Step 6 : commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
git add agent/agent.py agent/test_updater.py
git commit -m "feat(agent): converge to the cloud target and release the lock before execv"
```

---

### Task 11 : `launch.py` supervise

**Files:**
- Modify: `agent/launch.py`
- Modify: `agent/test_updater.py`

**Interfaces:**
- Consumes: `updater.pending_rollback`, `updater.rollback`, `updater.SUPERVISED_ENV`.
- Produces: `launch.supervise(agent_dir)` — vérifie le témoin, restaure si besoin ; ne lève jamais.

- [ ] **Step 1 : écrire les tests**

Ajouter à `agent/test_updater.py` :

```python
class SuperviseTest(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import launch

        self.launch = launch
        self.dir = tempfile.mkdtemp(prefix="sr-agent-supervise-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name in updater.BUNDLE_FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("# old\n")
        with open(os.path.join(self.dir, "VERSION"), "w") as f:
            f.write("1.0.0\n")

    def test_does_nothing_without_a_witness(self):
        self.launch.supervise(self.dir)
        with open(os.path.join(self.dir, "agent.py")) as f:
            self.assertEqual(f.read(), "# old\n")

    def test_leaves_a_fresh_witness_alone(self):
        # The launcher fires on EVERY menu navigation. Without the grace period
        # a navigation ten seconds after the swap would cancel a perfectly
        # healthy update, while it is running.
        updater.stage_and_swap(self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0")
        self.launch.supervise(self.dir)
        with open(os.path.join(self.dir, "agent.py")) as f:
            self.assertEqual(f.read(), "# new\n")

    def test_restores_after_an_unconfirmed_update_expires(self):
        updater.stage_and_swap(
            self.dir, bundle(agent_src="# new\n"), "1.0.0", "1.1.0", now=time.time() - 4000
        )
        self.launch.supervise(self.dir)
        with open(os.path.join(self.dir, "agent.py")) as f:
            self.assertEqual(f.read(), "# old\n")
        self.assertTrue(updater.has_failed(self.dir, "1.1.0"))

    def test_clears_a_confirmed_witness(self):
        updater.stage_and_swap(self.dir, bundle(), "1.0.0", "1.1.0")
        updater.confirm_update(self.dir)
        self.launch.supervise(self.dir)
        self.assertIsNone(updater.read_witness(self.dir))

    def test_never_raises_even_on_a_nonexistent_directory(self):
        # A broken updater must not be able to stop the agent from starting.
        self.launch.supervise("/nonexistent/sr-agent")
```

Ajouter `import time` aux imports du fichier de test.

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `cd /home/madjid/projets/recalbox-dashboard && python3 -m unittest discover -s agent 2>&1 | tail -10`
Expected: FAIL — `module 'launch' has no attribute 'supervise'`.

- [ ] **Step 3 : réécrire `agent/launch.py`**

```python
#!/usr/bin/env python3
"""Superviseur de l'agent Super-Retrogamers.

Deux responsabilites, dans cet ordre :

1. Verifier qu'une mise a jour precedente a fait ses preuves, et restaurer la
   version anterieure si elle n'en a jamais donne. Le lanceur se declenche a
   chaque navigation dans les menus, ce qui fait de cette verification une
   reparation rapide plutot qu'un rendez-vous au prochain demarrage.
2. Lancer agent.py en remplacant son propre processus.

Cette logique vit en Python et pas dans le script bash du lanceur parce que du
bash sur une box distante n'est pas testable — et parce que le lanceur, lui,
n'est jamais mis a jour : sa corruption serait le seul echec irrattrapable.

L'exclusion mutuelle (fcntl.flock()) vit dans agent.py, pas ici : l'ancien
chemin d'installation (custom.sh) lance agent.py directement, sans jamais
passer par ce superviseur, donc un verrou pose ici ne le verrait pas.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def agent_path():
    """Chemin de l'agent, toujours a cote de ce fichier."""
    return os.path.join(HERE, "agent.py")


def build_argv():
    """Arguments d'exec : le meme interpreteur que celui qui nous execute."""
    return [sys.executable, agent_path()]


def supervise(agent_dir):
    """Repare une mise a jour qui n'a jamais fait ses preuves. Ne leve jamais.

    L'import d'updater est protege : un updater.py casse ne doit pas pouvoir
    empecher l'agent de demarrer. C'est le seul endroit du systeme ou une
    exception se traduirait par une box definitivement muette.
    """
    try:
        sys.path.insert(0, agent_dir)
        import updater

        witness = updater.read_witness(agent_dir)
        if witness is None:
            return
        if witness.get("confirmed"):
            updater.clear_witness(agent_dir)
            return
        if updater.pending_rollback(agent_dir):
            updater.rollback(agent_dir)
    except Exception as e:  # noqa: BLE001 — starting the agent outranks everything
        sys.stderr.write("supervise: skipped (%s)\n" % e)


def main():
    supervise(HERE)
    # Marque cette execution comme supervisee : agent.py ne se met a jour que
    # s'il voit cette variable, parce qu'une box lancee par l'ancien custom.sh
    # n'a personne pour la reparer si la nouvelle version ne demarre pas.
    # os.execv herite de l'environnement, donc elle survit aussi au redemarrage
    # que l'agent declenche lui-meme apres une bascule.
    os.environ["SR_AGENT_SUPERVISED"] = "1"
    argv = build_argv()
    # os.execv replaces the process image entirely: no supervisor process lingers.
    # agent.py acquires the single-instance lock itself right after it starts.
    os.execv(argv[0], argv)


if __name__ == "__main__":
    main()
```

**Note** : la valeur `"SR_AGENT_SUPERVISED"` est écrite en dur ici plutôt qu'importée d'`updater`, pour que `main()` reste correct même si l'import d'`updater` a échoué. Un test de Task 10 vérifie que la constante `updater.SUPERVISED_ENV` porte bien la même chaîne — ajouter :

```python
    def test_the_env_name_matches_the_launcher(self):
        # launch.py hard-codes the string so it stays correct even when the
        # updater import fails; this asserts the two never drift.
        self.assertEqual(updater.SUPERVISED_ENV, "SR_AGENT_SUPERVISED")
```

- [ ] **Step 4 : lancer toute la suite Python**

Run: `cd /home/madjid/projets/recalbox-dashboard && timeout 120 python3 -m unittest discover -s agent 2>&1 | tail -10`
Expected: OK, tous les tests (anciens compris) passent.

- [ ] **Step 5 : commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
git add agent/launch.py agent/test_updater.py
git commit -m "feat(agent): repair an unproven update from the launcher"
```

---

### Task 12 : `GET`/`PUT /api/agent-rollout`

**Files:**
- Modify: `apps/dashboard/lib/db/agent-rollout-queries.ts`
- Create: `apps/dashboard/lib/db/__tests__/agent-rollout-queries.test.ts`
- Create: `apps/dashboard/app/api/agent-rollout/route.ts`
- Create: `apps/dashboard/app/api/agent-rollout/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `readRolloutSettings`/`writeRolloutSettings` (Task 4), `readAgentVersion` (Task 4), `compareVersions` (Task 1).
- Produces:
  - `type FleetVersionRow = { version: string; boxes: number; seenLastHour: number }`
  - `readFleetVersions(db: DB): Promise<FleetVersionRow[]>`
  - `GET` rend `{ deployedVersion, targetVersion, rolloutPercent, versions: FleetVersionRow[] }` ; `PUT` accepte `{ targetVersion?, rolloutPercent? }`.

- [ ] **Step 1 : écrire le test de la répartition du parc**

Créer `apps/dashboard/lib/db/__tests__/agent-rollout-queries.test.ts` :

```ts
import { readFleetVersions } from '@/lib/db/agent-rollout-queries'
import { describe, expect, it } from 'vitest'

const HOUR = 60 * 60 * 1000

function fakeDb(rows: unknown[]) {
	const chain = {
		from: () => chain,
		where: () => chain,
		all: async () => rows,
	}
	return { select: () => chain } as never
}

describe('readFleetVersions', () => {
	it('counts one box per version and how many spoke in the last hour', async () => {
		const now = Date.now()
		const res = await readFleetVersions(
			fakeDb([
				{ recalboxId: 'a', version: '1.1.0', lastUsedAt: new Date(now - 60_000) },
				{ recalboxId: 'b', version: '1.0.0', lastUsedAt: new Date(now - 60_000) },
				{ recalboxId: 'c', version: '1.0.0', lastUsedAt: new Date(now - 5 * HOUR) },
			]),
		)
		expect(res).toEqual([
			{ version: '1.1.0', boxes: 1, seenLastHour: 1 },
			{ version: '1.0.0', boxes: 2, seenLastHour: 1 },
		])
	})

	it('counts a box once even when it holds several tokens', async () => {
		// A box that was re-installed keeps its old token rows; counting rows
		// instead of boxes would inflate the fleet and make a rollout look
		// healthier than it is.
		const now = Date.now()
		const res = await readFleetVersions(
			fakeDb([
				{ recalboxId: 'a', version: '1.0.0', lastUsedAt: new Date(now - 10 * HOUR) },
				{ recalboxId: 'a', version: '1.1.0', lastUsedAt: new Date(now - 60_000) },
			]),
		)
		expect(res).toEqual([{ version: '1.1.0', boxes: 1, seenLastHour: 1 }])
	})

	it('is empty when no box ever declared a version', async () => {
		expect(await readFleetVersions(fakeDb([]))).toEqual([])
	})
})
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run lib/db/__tests__/agent-rollout-queries.test.ts`
Expected: FAIL — `readFleetVersions` n'est pas exportée.

- [ ] **Step 3 : ajouter `readFleetVersions`**

À la fin de `apps/dashboard/lib/db/agent-rollout-queries.ts` :

```ts
export type FleetVersionRow = {
	version: string
	boxes: number
	/** Box de cette version ayant donné signe de vie dans la dernière heure. */
	seenLastHour: number
}

const LIVENESS_WINDOW_MS = 60 * 60 * 1000

/**
 * Répartition des versions dans le parc — la seule vue qui compte pendant un
 * déploiement : une version dont le taux de présence s'effondre est une version
 * à rapatrier.
 *
 * L'agrégation se fait en JavaScript plutôt qu'en SQL : le parc tient en
 * quelques dizaines de lignes, et une box qui porte plusieurs jetons (une
 * réinstallation en laisse) ne doit compter qu'une fois — une règle plus claire
 * à lire ici qu'en `count(distinct case when …)`.
 */
export async function readFleetVersions(db: DB): Promise<FleetVersionRow[]> {
	const rows = await db
		.select({
			recalboxId: agentTokens.recalboxId,
			version: agentTokens.agentVersion,
			lastUsedAt: agentTokens.lastUsedAt,
		})
		.from(agentTokens)
		.where(and(isNull(agentTokens.revokedAt), isNotNull(agentTokens.agentVersion)))
		.all()

	const latest = new Map<string, { version: string; at: number }>()
	for (const row of rows) {
		if (!row.version) continue
		const at = row.lastUsedAt?.getTime() ?? 0
		const seen = latest.get(row.recalboxId)
		if (!seen || at > seen.at) latest.set(row.recalboxId, { version: row.version, at })
	}

	const cutoff = Date.now() - LIVENESS_WINDOW_MS
	const byVersion = new Map<string, { boxes: number; seenLastHour: number }>()
	for (const { version, at } of latest.values()) {
		const acc = byVersion.get(version) ?? { boxes: 0, seenLastHour: 0 }
		acc.boxes += 1
		if (at >= cutoff) acc.seenLastHour += 1
		byVersion.set(version, acc)
	}

	return [...byVersion.entries()]
		.map(([version, acc]) => ({ version, ...acc }))
		.sort((a, b) => compareVersions(b.version, a.version))
}
```

Compléter les imports du fichier : `compareVersions` depuis `@/lib/agent/version`, `agentTokens` depuis `@/lib/db/schema`, `and`, `isNull`, `isNotNull` depuis `drizzle-orm`.

- [ ] **Step 4 : lancer le test, vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run lib/db/__tests__/agent-rollout-queries.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5 : écrire le test de la route**

Créer `apps/dashboard/app/api/agent-rollout/__tests__/route.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const isAdmin = vi.fn()
const readFleetVersions = vi.fn()
const readRolloutSettings = vi.fn()
const writeRolloutSettings = vi.fn()
const readAgentVersion = vi.fn()

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/auth/require-user', () => ({
	getUser: () => getUser(),
	unauthorized: () => new Response(null, { status: 401 }),
	forbidden: () => new Response(null, { status: 403 }),
}))
vi.mock('@/lib/auth/ownership', () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }))
vi.mock('@/lib/db/agent-rollout-queries', () => ({
	readFleetVersions: () => readFleetVersions(),
}))
vi.mock('@/lib/agent/rollout-settings', () => ({
	readRolloutSettings: () => readRolloutSettings(),
	writeRolloutSettings: (...a: unknown[]) => writeRolloutSettings(...a),
}))
vi.mock('@/lib/agent/payload', () => ({ readAgentVersion: () => readAgentVersion() }))

import { GET, PUT } from '../route'

function put(body: unknown) {
	return { json: async () => body } as never
}

afterEach(() => {
	for (const m of [
		getUser,
		isAdmin,
		readFleetVersions,
		readRolloutSettings,
		writeRolloutSettings,
		readAgentVersion,
	]) {
		m.mockReset()
	}
})

function asAdmin() {
	getUser.mockResolvedValue({ id: 'u1' })
	isAdmin.mockReturnValue(true)
	readAgentVersion.mockResolvedValue('1.1.0')
	readRolloutSettings.mockResolvedValue({ targetVersion: '1.1.0', rolloutPercent: 0 })
	readFleetVersions.mockResolvedValue([{ version: '1.0.0', boxes: 2, seenLastHour: 2 }])
}

describe('GET /api/agent-rollout', () => {
	it('401s when signed out', async () => {
		getUser.mockResolvedValue(null)
		expect((await GET()).status).toBe(401)
	})

	it('403s for a non-admin', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		isAdmin.mockReturnValue(false)
		expect((await GET()).status).toBe(403)
	})

	it('returns the deployed version, the settings and the fleet', async () => {
		asAdmin()
		const body = await (await GET()).json()
		expect(body).toEqual({
			deployedVersion: '1.1.0',
			targetVersion: '1.1.0',
			rolloutPercent: 0,
			versions: [{ version: '1.0.0', boxes: 2, seenLastHour: 2 }],
		})
	})
})

describe('PUT /api/agent-rollout', () => {
	it('403s for a non-admin', async () => {
		getUser.mockResolvedValue({ id: 'u1' })
		isAdmin.mockReturnValue(false)
		expect((await PUT(put({ rolloutPercent: 50 }))).status).toBe(403)
	})

	it('accepts a percentage', async () => {
		asAdmin()
		expect((await PUT(put({ rolloutPercent: 50 }))).status).toBe(200)
		expect(writeRolloutSettings).toHaveBeenCalledWith({ rolloutPercent: 50 })
	})

	it('accepts the deployed version as a target', async () => {
		asAdmin()
		expect((await PUT(put({ targetVersion: '1.1.0' }))).status).toBe(200)
	})

	it('accepts a version some box actually reports', async () => {
		asAdmin()
		expect((await PUT(put({ targetVersion: '1.0.0' }))).status).toBe(200)
	})

	it('refuses a version that exists nowhere', async () => {
		// A typo here would send the whole fleet converging towards nothing —
		// and since nobody could reach it, nothing would move: a silent outage.
		asAdmin()
		const res = await PUT(put({ targetVersion: '1.1.O' }))
		expect(res.status).toBe(422)
		expect(writeRolloutSettings).not.toHaveBeenCalled()
	})

	it('refuses a percentage out of range', async () => {
		asAdmin()
		expect((await PUT(put({ rolloutPercent: 500 }))).status).toBe(422)
	})
})
```

- [ ] **Step 6 : lancer le test, vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run app/api/agent-rollout/__tests__/route.test.ts`
Expected: FAIL — `../route` introuvable.

- [ ] **Step 7 : écrire la route**

Créer `apps/dashboard/app/api/agent-rollout/route.ts` :

```ts
import { readAgentVersion } from '@/lib/agent/payload'
import { readRolloutSettings, writeRolloutSettings } from '@/lib/agent/rollout-settings'
import { isAdmin } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { readFleetVersions } from '@/lib/db/agent-rollout-queries'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Commandes de déploiement du parc. Au premier niveau et NON sous `/api/agent/`,
// qui désigne les routes authentifiées par jeton de machine : y glisser une
// route à session humaine invite à confondre les deux modèles d'authentification.
export async function GET() {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()

	const [deployedVersion, settings, versions] = await Promise.all([
		readAgentVersion(),
		readRolloutSettings(),
		readFleetVersions(db),
	])
	return NextResponse.json({ deployedVersion, ...settings, versions })
}

const updateSchema = z.object({
	targetVersion: z.string().min(1).max(32).optional(),
	rolloutPercent: z.number().int().min(0).max(100).optional(),
})

export async function PUT(req: NextRequest) {
	const user = await getUser()
	if (!user) return unauthorized()
	if (!isAdmin(user)) return forbidden()

	const body = await req.json().catch(() => null)
	const parsed = updateSchema.safeParse(body)
	if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 422 })

	if (parsed.data.targetVersion !== undefined) {
		// La cible n'est pas un champ libre. Une faute de frappe enverrait le parc
		// converger vers une version qui n'existe nulle part : personne n'y
		// arriverait, donc rien ne bougerait — une panne parfaitement silencieuse.
		// L'ensemble autorisé se construit tout seul à partir de la télémétrie.
		const [deployed, fleet] = await Promise.all([readAgentVersion(), readFleetVersions(db)])
		const allowed = new Set([deployed, ...fleet.map((v) => v.version)])
		if (!allowed.has(parsed.data.targetVersion)) {
			return NextResponse.json(
				{ error: `Unknown target version: ${parsed.data.targetVersion}` },
				{ status: 422 },
			)
		}
	}

	await writeRolloutSettings(parsed.data)
	return NextResponse.json({ ok: true })
}
```

- [ ] **Step 8 : lancer le test, vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run app/api/agent-rollout/__tests__/route.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 9 : lint et commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
git add apps/dashboard/lib/db/agent-rollout-queries.ts apps/dashboard/lib/db/__tests__/ apps/dashboard/app/api/agent-rollout/
git commit -m "feat(agent): add the admin rollout endpoint and fleet version rollup"
```

---

### Task 13 : la section de déploiement dans `/admin`

**Files:**
- Create: `apps/dashboard/components/admin/agent-rollout-section.tsx`
- Create: `apps/dashboard/components/admin/__tests__/agent-rollout-section.test.tsx`
- Modify: `apps/dashboard/app/[locale]/admin/page.tsx`
- Modify: `apps/dashboard/messages/fr.json`, `apps/dashboard/messages/en.json`

**Interfaces:**
- Consumes: `GET`/`PUT /api/agent-rollout` (Task 12).
- Produces: `<AgentRolloutSection />`, sans props.

- [ ] **Step 1 : ajouter les traductions**

Dans `apps/dashboard/messages/fr.json`, une clé de premier niveau `agentRollout` :

```json
	"agentRollout": {
		"heading": "Déploiement de l'agent",
		"deployed": "Version déployée : {version}",
		"target": "Version cible",
		"percent": "Part des box « stable » qui basculent",
		"colVersion": "Version",
		"colBoxes": "Box",
		"colSeen": "Vues dans l'heure",
		"empty": "Aucune box n'a encore déclaré sa version.",
		"loadError": "Impossible de lire l'état du déploiement.",
		"saveError": "Impossible d'enregistrer.",
		"saved": "Enregistré."
	},
```

Dans `apps/dashboard/messages/en.json`, les mêmes clés :

```json
	"agentRollout": {
		"heading": "Agent rollout",
		"deployed": "Deployed version: {version}",
		"target": "Target version",
		"percent": "Share of stable boxes that move",
		"colVersion": "Version",
		"colBoxes": "Boxes",
		"colSeen": "Seen in the last hour",
		"empty": "No box has declared its version yet.",
		"loadError": "Could not read the rollout state.",
		"saveError": "Could not save.",
		"saved": "Saved."
	},
```

- [ ] **Step 2 : écrire le test**

Créer `apps/dashboard/components/admin/__tests__/agent-rollout-section.test.tsx`. **`vitest.config.ts` déclare `environment: 'node'`** : un test de composant doit ouvrir par le commentaire magique `// @vitest-environment jsdom`, exactement comme `components/recalboxes/__tests__/setup-wizard.test.tsx`. Les messages chargés sont ceux de `fr.json`, donc les libellés cherchés sont les français.

```tsx
// @vitest-environment jsdom
import { AgentRolloutSection } from '@/components/admin/agent-rollout-section'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import messages from '@/messages/fr.json'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

function renderSection() {
	return render(
		<NextIntlClientProvider locale="fr" messages={messages}>
			<AgentRolloutSection />
		</NextIntlClientProvider>,
	)
}

const state = {
	deployedVersion: '1.1.0',
	targetVersion: '1.1.0',
	rolloutPercent: 0,
	versions: [
		{ version: '1.1.0', boxes: 1, seenLastHour: 1 },
		{ version: '1.0.0', boxes: 3, seenLastHour: 2 },
	],
}

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

function stubFetch(put = vi.fn().mockResolvedValue({ ok: true })) {
	vi.stubGlobal(
		'fetch',
		vi.fn((_url: string, init?: RequestInit) =>
			init?.method === 'PUT'
				? put(init)
				: Promise.resolve({ ok: true, json: async () => state }),
		),
	)
}

describe('AgentRolloutSection', () => {
	it('shows one row per version with its liveness', async () => {
		stubFetch()
		renderSection()
		expect(await screen.findByText('1.0.0')).toBeInTheDocument()
		expect(screen.getByText('1.1.0')).toBeInTheDocument()
	})

	it('offers only versions that exist, never a free text field', async () => {
		// The guard against typing a version that exists nowhere lives in the UI
		// as well as the API: the select cannot express the mistake.
		stubFetch()
		renderSection()
		const select = (await screen.findByLabelText('Version cible')) as HTMLSelectElement
		expect(select.tagName).toBe('SELECT')
		expect([...select.options].map((o) => o.value).sort()).toEqual(['1.0.0', '1.1.0'])
	})

	it('sends the chosen percentage step', async () => {
		const put = vi.fn().mockResolvedValue({ ok: true })
		stubFetch(put)
		renderSection()
		fireEvent.click(await screen.findByRole('button', { name: '25' }))
		await waitFor(() => expect(put).toHaveBeenCalled())
		expect(JSON.parse(put.mock.calls[0][0].body)).toEqual({ rolloutPercent: 25 })
	})
})
```

- [ ] **Step 3 : lancer le test, vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run components/admin/__tests__/agent-rollout-section.test.tsx`
Expected: FAIL — composant introuvable.

- [ ] **Step 4 : écrire le composant**

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

type FleetVersion = { version: string; boxes: number; seenLastHour: number }
type Rollout = {
	deployedVersion: string
	targetVersion: string
	rolloutPercent: number
	versions: FleetVersion[]
}

/** Paliers cliquables plutôt qu'un champ libre : les deux gestes d'urgence —
 * tout arrêter (0) et tout rapatrier (100) — deviennent atteignables en un clic. */
const STEPS = [0, 10, 25, 50, 100]

export function AgentRolloutSection() {
	const t = useTranslations('agentRollout')
	const [state, setState] = useState<Rollout | null>(null)
	const [saving, setSaving] = useState(false)

	const load = useCallback(async () => {
		try {
			const res = await fetch('/api/agent-rollout')
			if (!res.ok) throw new Error()
			setState(await res.json())
		} catch {
			toast.error(t('loadError'))
		}
	}, [t])

	useEffect(() => {
		void load()
	}, [load])

	async function save(patch: { targetVersion?: string; rolloutPercent?: number }) {
		setSaving(true)
		try {
			const res = await fetch('/api/agent-rollout', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch),
			})
			if (!res.ok) throw new Error()
			toast.success(t('saved'))
			await load()
		} catch {
			toast.error(t('saveError'))
		} finally {
			setSaving(false)
		}
	}

	if (!state) return null

	// La liste des cibles se construit à partir de ce qui existe réellement :
	// la version déployée, plus toute version qu'au moins une box déclare.
	const targets = [...new Set([state.deployedVersion, ...state.versions.map((v) => v.version)])]

	return (
		<section className="space-y-4 border rounded-lg p-4">
			<h2 className="font-medium">{t('heading')}</h2>
			<p className="text-sm text-muted-foreground">
				{t('deployed', { version: state.deployedVersion })}
			</p>

			<div className="space-y-1">
				<label className="text-xs text-muted-foreground" htmlFor="agent-target">
					{t('target')}
				</label>
				<select
					id="agent-target"
					className="block rounded border bg-background px-2 py-1 text-sm"
					value={state.targetVersion}
					disabled={saving}
					onChange={(e) => void save({ targetVersion: e.target.value })}
				>
					{targets.map((v) => (
						<option key={v} value={v}>
							{v}
						</option>
					))}
				</select>
			</div>

			<div className="space-y-1">
				<span className="block text-xs text-muted-foreground">{t('percent')}</span>
				<div className="flex gap-2">
					{STEPS.map((step) => (
						<Button
							key={step}
							type="button"
							size="sm"
							variant={state.rolloutPercent === step ? 'default' : 'outline'}
							disabled={saving}
							onClick={() => void save({ rolloutPercent: step })}
						>
							{step}
						</Button>
					))}
				</div>
			</div>

			{state.versions.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t('empty')}</p>
			) : (
				<table className="w-full text-sm">
					<thead>
						<tr className="text-left text-xs text-muted-foreground">
							<th className="font-normal">{t('colVersion')}</th>
							<th className="font-normal">{t('colBoxes')}</th>
							<th className="font-normal">{t('colSeen')}</th>
						</tr>
					</thead>
					<tbody>
						{state.versions.map((v) => (
							<tr key={v.version}>
								<td>{v.version}</td>
								<td>{v.boxes}</td>
								<td>{v.seenLastHour}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</section>
	)
}
```

- [ ] **Step 5 : monter la section dans `/admin`**

Dans `apps/dashboard/app/[locale]/admin/page.tsx`, importer le composant et l'insérer juste après `<InvitationsSection />` :

```tsx
			<InvitationsSection />
			<AgentRolloutSection />
```

- [ ] **Step 6 : lancer les tests, vérifier qu'ils passent**

Run: `cd apps/dashboard && pnpm exec vitest run components/admin/ && pnpm exec tsc --noEmit`
Expected: PASS des deux côtés.

- [ ] **Step 7 : lint et commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
git add apps/dashboard/components/admin/ apps/dashboard/app/\[locale\]/admin/page.tsx apps/dashboard/messages/
git commit -m "feat(admin): show the fleet version split and drive the rollout"
```

---

### Task 14 : le canal sur la page d'édition de la box

**Files:**
- Modify: `apps/dashboard/app/api/recalboxes/[id]/route.ts`
- Create: `apps/dashboard/components/agent-channel-section.tsx`
- Modify: `apps/dashboard/app/[locale]/recalboxes/[id]/edit/page.tsx`
- Modify: `apps/dashboard/messages/fr.json`, `apps/dashboard/messages/en.json`
- Test: `apps/dashboard/app/api/recalboxes/[id]/__tests__/route.test.ts` (créer si absent)

**Interfaces:**
- Consumes: `PUT /api/recalboxes/[id]`.
- Produces: `<AgentChannelSection recalboxId={string} />`.

- [ ] **Step 1 : accepter `agentChannel` côté API**

Dans `apps/dashboard/app/api/recalboxes/[id]/route.ts`, ajouter à `updateSchema` :

```ts
	archived: z.boolean().optional(),
	// 'beta' fait basculer cette box dès qu'une version est déployée, sans
	// attendre le pourcentage. Explicite plutôt que tiré au sort : c'est ce qui
	// permet de choisir QUI essuie les plâtres.
	agentChannel: z.enum(['stable', 'beta']).optional(),
```

Vérifier que `configStore.updateRecalboxConfig` propage bien le champ jusqu'à `updateRecalbox` — sinon ajouter `agentChannel` au type de patch de `lib/config-store.ts` et à `updateRecalbox` dans `lib/db/recalbox-queries.ts`, en suivant exactement la façon dont `archived` y circule.

- [ ] **Step 2 : ajouter les traductions**

Dans `messages/fr.json`, sous la clé `recalboxes` existante :

```json
		"channel": {
			"heading": "Canal de mise à jour",
			"stable": "Stable",
			"beta": "Bêta — cette box essuie les plâtres",
			"hint": "Une box en bêta prend chaque nouvelle version immédiatement, sans attendre le déploiement progressif.",
			"error": "Impossible de changer le canal."
		},
```

Dans `messages/en.json` :

```json
		"channel": {
			"heading": "Update channel",
			"stable": "Stable",
			"beta": "Beta — this box goes first",
			"hint": "A beta box takes each new version immediately, without waiting for the progressive rollout.",
			"error": "Could not change the channel."
		},
```

- [ ] **Step 3 : écrire le composant**

Créer `apps/dashboard/components/agent-channel-section.tsx` :

```tsx
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

type Channel = 'stable' | 'beta'

/**
 * Choix du canal, à côté des jetons de la box — la page où l'on gère déjà tout
 * ce qui la relie au cloud. Volontairement séparé de `RecalboxForm`, partagé
 * avec la page d'ajout : une box qu'on vient de créer n'a pas encore d'agent.
 */
export function AgentChannelSection({ recalboxId }: { recalboxId: string }) {
	const t = useTranslations('recalboxes.channel')
	const [channel, setChannel] = useState<Channel | null>(null)

	useEffect(() => {
		fetch(`/api/recalboxes/${recalboxId}`)
			.then((r) => r.json())
			.then((d: { agentChannel?: string }) => setChannel(d.agentChannel === 'beta' ? 'beta' : 'stable'))
			.catch(() => {})
	}, [recalboxId])

	async function change(next: Channel) {
		const previous = channel
		setChannel(next)
		const res = await fetch(`/api/recalboxes/${recalboxId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ agentChannel: next }),
		}).catch(() => null)
		if (!res?.ok) {
			setChannel(previous)
			toast.error(t('error'))
		}
	}

	if (!channel) return null

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">{t('heading')}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				<select
					aria-label={t('heading')}
					className="block w-full rounded border bg-background px-2 py-1 text-sm"
					value={channel}
					onChange={(e) => void change(e.target.value as Channel)}
				>
					<option value="stable">{t('stable')}</option>
					<option value="beta">{t('beta')}</option>
				</select>
				<p className="text-xs text-muted-foreground">{t('hint')}</p>
			</CardContent>
		</Card>
	)
}
```

- [ ] **Step 4 : monter le composant**

Dans `apps/dashboard/app/[locale]/recalboxes/[id]/edit/page.tsx`, importer et insérer avant `<AgentTokensSection …>` :

```tsx
			<AgentChannelSection recalboxId={id} />
			<AgentTokensSection recalboxId={id} />
```

- [ ] **Step 5 : vérifier de bout en bout**

Run: `cd apps/dashboard && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS des deux côtés.

- [ ] **Step 6 : lint et commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
git add apps/dashboard/app/api/recalboxes/ apps/dashboard/components/agent-channel-section.tsx apps/dashboard/app/\[locale\]/recalboxes/ apps/dashboard/messages/ apps/dashboard/lib/
git commit -m "feat(recalboxes): choose the agent update channel per box"
```

---

### Task 15 : monter la version, documenter, vérifier

Sans cette tâche le mécanisme est inerte : le dépôt annonce toujours `1.0.0`, donc aucune box n'a jamais rien à faire.

**Files:**
- Modify: `agent/VERSION`
- Modify: `agent/README.md`, `README.md`, `CHANGELOG.md`, `docs/serverless-deploy.md`

- [ ] **Step 1 : monter la version**

```bash
cd /home/madjid/projets/recalbox-dashboard
printf '1.1.0\n' > agent/VERSION
```

- [ ] **Step 2 : documenter dans `agent/README.md`**

Ajouter une section, après le tableau des routes :

```markdown
## Mise à jour automatique

L'agent converge vers la version que le cloud lui annonce dans la réponse de sa
boucle de commandes (`agent.target_version`), et déclare la sienne dans l'en-tête
`X-Agent-Version` de chaque requête.

Une bascule télécharge le paquet (`GET /api/agent/download`), le vérifie par
`py_compile`, copie l'ancien dans `backup/`, pose le témoin `update.json`, échange
les fichiers et se relance par `execv`. Le témoin passe à `confirmed` au premier
aller-retour réussi avec le cloud ; s'il ne l'est toujours pas dix minutes plus
tard, `launch.py` restaure `backup/` au lancement suivant et inscrit la version
fautive dans `failed.json`, qui empêche de la retenter.

Fichiers remplacés : `agent.py`, `scan_roms.py`, `launch.py`, `updater.py`,
`VERSION`. **Jamais** `config.json` (il porte le jeton) ni le lanceur
`userscripts/` (sa corruption serait irrattrapable).

Deux garde-fous : l'agent ne se met à jour que lancé par `launch.py`, qui pose
`SR_AGENT_SUPERVISED=1` — une box encore sur l'ancien `custom.sh` n'aurait
personne pour la réparer. Et une bascule attend qu'aucune partie ni aucun scan
ne soit en cours, sans délai maximal : un `execv` au milieu d'une partie
perdrait la session.

Le déploiement se pilote depuis `/admin` : version cible (choisie dans une liste,
jamais saisie), part des box `stable` qui basculent, et canal par box (`stable`
ou `beta`, sur la page d'édition de la Recalbox).
```

- [ ] **Step 3 : documenter dans le `README.md` racine et le `CHANGELOG.md`**

Dans `README.md`, compléter la section qui décrit l'agent d'une phrase indiquant qu'il se met à jour seul. Dans `CHANGELOG.md`, sous `## [2.1.0] - Unreleased`, ajouter :

```markdown
### Ajouté

- Mise à jour automatique de l'agent : chaque box converge vers la version que le cloud
  lui désigne, vérifie le paquet avant de basculer, et restaure la précédente si la
  nouvelle ne parle jamais au cloud.
- Déploiement progressif : version cible et pourcentage de bascule réglables depuis
  `/admin`, canal `stable`/`beta` par Recalbox, et tableau de répartition des versions
  du parc.
```

- [ ] **Step 4 : vérification complète**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm lint
cd apps/dashboard && pnpm exec vitest run && pnpm exec tsc --noEmit
timeout 180 python3 -m unittest discover -s agent
```
Expected: tout au vert.

- [ ] **Step 5 : vérifier que le build de production embarque le nouveau fichier**

```bash
cd /home/madjid/projets/recalbox-dashboard
pnpm build 2>&1 | grep -i "copy-agent-payload"
ls apps/dashboard/.next/standalone/apps/dashboard/agent-payload/
```
Expected: la ligne de copie mentionne 6 fichiers, et `updater.py` **est présent** dans `agent-payload/` du build standalone. **S'il manque, c'est la panne de production silencieuse décrite dans `next.config.ts`** : le traçage n'a pas pris la nouvelle route, et `/api/agent/download` renverra 500 en prod sans avoir échoué au build.

- [ ] **Step 6 : commit**

```bash
cd /home/madjid/projets/recalbox-dashboard
git add agent/VERSION agent/README.md README.md CHANGELOG.md
git commit -m "docs(agent): document auto-update and bump the agent to 1.1.0"
```

---

## Recette manuelle — la seule preuve qui compte

À faire après la dernière tâche, sur la vraie box, **avant** de considérer le travail terminé. C'est un glisser-déposer réel qui a trouvé le défaut le plus grave de la fonctionnalité précédente, après quatorze relectures et 1482 tests.

1. Déployer en production (`vercel --prod` depuis la racine — rien ne se déploie tout seul).
2. Passer sa box en canal `beta` depuis sa page d'édition.
3. Réinstaller l'agent depuis l'assistant (le zip embarque maintenant `updater.py` et `VERSION`), redémarrer la box.
4. Vérifier dans `/admin` que la box déclare `1.1.0`.
5. Monter `agent/VERSION` à `1.1.1`, redéployer, et **regarder la box basculer seule** — sans y toucher. `agent.log` sur la box doit montrer `Updated 1.1.0 -> 1.1.1, restarting`, puis un seul agent en vie.
6. Forcer le rapatriement : cible à `1.1.0` depuis `/admin`. La box doit redescendre depuis sa sauvegarde locale, sans rien télécharger.
7. Vérifier que `custom.sh` n'a pas été touché (`md5sum /recalbox/share/system/custom.sh`).
