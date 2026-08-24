# Installation plug & play de l'agent — plan d'implémentation

> **Pour les agents exécutants :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans` pour dérouler ce plan tâche par tâche. Les étapes
> utilisent des cases à cocher (`- [ ]`).

**Goal:** Permettre à un utilisateur non technique de connecter sa Recalbox depuis le
dashboard — télécharger un zip pré-configuré, le glisser dans le partage réseau de la
box, redémarrer — sans terminal ni mot de passe.

**Architecture:** Un point de téléchargement authentifié assemble à la volée un zip qui
reproduit l'arborescence du partage Recalbox (`system/` + `userscripts/`) et qui embarque
un token d'agent fraîchement frappé. Sur la box, un script déposé dans
`userscripts/` est déclenché par EmulationStation à chaque affichage de la liste des
systèmes — donc au démarrage, et à répétition, ce qui en fait aussi un chien de garde.
Côté application, un assistant en trois écrans remplace le formulaire technique en mode
serverless et attend le premier appel de la box.

**Tech Stack:** Next.js 16 (App Router, runtime Node), TypeScript, Drizzle, Vitest,
Biome, `fflate` (nouvelle dépendance), Python 3 stdlib côté box.

**Spec:** [`docs/superpowers/specs/2026-08-18-agent-plug-and-play-install-design.md`](../specs/2026-08-18-agent-plug-and-play-install-design.md)

## Portée de ce plan

Ce plan couvre les pièces **A, B et C** de la spec : le point de téléchargement, le
lanceur, l'assistant. À sa fin, une box neuve s'enrôle sans terminal.

Les pièces **D et E** (mise à jour automatique, déploiement progressif) font l'objet
d'un second plan. Motif : elles n'ont de sens qu'une fois des agents installés sur le
terrain, et l'installation est ce qui débloque les premiers testeurs. Ce plan prépare
leur arrivée — il crée `launch.py` et `agent/VERSION` — sans implémenter leur logique.

## Contraintes globales

- **Style Biome** : tabulations, guillemets simples, **pas de point-virgule**, virgules
  finales. Vérifier avec `pnpm exec biome check <fichiers>` avant chaque commit.
- **Les tests vivent dans un sous-dossier `__tests__/`** à côté du code testé.
- **Alias `@`** → `apps/dashboard/`.
- **Toutes les routes API** portent `export const dynamic = 'force-dynamic'` et
  `export const runtime = 'nodejs'`.
- **Mode serverless** = `isServerlessMode()` (`AGENT_ONLY_MEDIA === '1'`) côté serveur,
  `useServerless()` côté client. Le mode auto-hébergé ne doit changer en rien.
- **i18n obligatoire** : toute chaîne visible passe par `next-intl`, ajoutée dans
  `messages/en.json` ET `messages/fr.json`.
- **Chemins exacts sur la box** : agent dans `/recalbox/share/system/sr-agent/`,
  lanceur dans `/recalbox/share/userscripts/sr-agent[systembrowsing].sh`.
- **Ne jamais écrire dans `custom.sh`** — c'est tout l'intérêt du choix `userscripts/`.
- Lancer les tests depuis `apps/dashboard` : `pnpm exec vitest run <fichier>`.

---

### Task 1: Rendre les fichiers de l'agent lisibles depuis une fonction serveur

Les fichiers de l'agent vivent à la racine du dépôt (`agent/`), **hors** de
`apps/dashboard/`. Avec `output: 'standalone'`, Next ne les embarque pas : sans
déclaration explicite, la route de téléchargement fonctionnera en local et échouera en
production. C'est le piège principal de ce plan, donc il se traite en premier.

**Files:**
- Create: `apps/dashboard/lib/agent/payload.ts`
- Create: `apps/dashboard/lib/agent/__tests__/payload.test.ts`
- Modify: `apps/dashboard/next.config.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `readAgentPayload(): Promise<AgentPayload>` où
  `type AgentPayload = { agentPy: string; scanRomsPy: string; version: string }`.

- [ ] **Step 1: Créer le fichier de version**

Créer `agent/VERSION` avec exactement une ligne :

```
1.0.0
```

- [ ] **Step 2: Écrire le test qui échoue**

Créer `apps/dashboard/lib/agent/__tests__/payload.test.ts` :

```ts
import { readAgentPayload } from '@/lib/agent/payload'
import { describe, expect, it } from 'vitest'

describe('readAgentPayload', () => {
	it('lit les deux fichiers Python de l agent', async () => {
		const payload = await readAgentPayload()
		// Marqueurs stables : présents dans agent.py et scan_roms.py depuis leur création.
		expect(payload.agentPy).toContain('CONFIG_PATH')
		expect(payload.scanRomsPy.length).toBeGreaterThan(1000)
	})

	it('lit la version et la débarrasse des espaces', async () => {
		const payload = await readAgentPayload()
		expect(payload.version).toMatch(/^\d+\.\d+\.\d+$/)
	})
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/payload.test.ts`
Expected: FAIL — `Cannot find module '@/lib/agent/payload'`

- [ ] **Step 4: Implémenter la lecture**

Créer `apps/dashboard/lib/agent/payload.ts` :

```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type AgentPayload = {
	agentPy: string
	scanRomsPy: string
	version: string
}

/**
 * Racine du dossier `agent/`, à la racine du monorepo — donc DEUX niveaux au-dessus
 * de `apps/dashboard`, qui est le cwd du serveur Next.
 *
 * Ces fichiers ne sont pas dans le périmètre que Next trace tout seul : ils sont
 * déclarés à la main via `outputFileTracingIncludes` dans next.config.ts. Toucher
 * l'un sans l'autre casse la production sans casser le local.
 */
function agentDir(): string {
	return path.resolve(process.cwd(), '..', '..', 'agent')
}

export async function readAgentPayload(): Promise<AgentPayload> {
	const [agentPy, scanRomsPy, version] = await Promise.all([
		readFile(path.join(agentDir(), 'agent.py'), 'utf-8'),
		readFile(path.join(agentDir(), 'scan_roms.py'), 'utf-8'),
		readFile(path.join(agentDir(), 'VERSION'), 'utf-8'),
	])
	return { agentPy, scanRomsPy, version: version.trim() }
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/payload.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Déclarer les fichiers à Next**

Modifier `apps/dashboard/next.config.ts`, en ajoutant deux clés au niveau racine de
`nextConfig`, juste après `serverExternalPackages` :

```ts
	// Le dossier `agent/` vit à la racine du monorepo, hors du périmètre que Next
	// trace automatiquement. Sans ces deux lignes, /api/recalboxes/[id]/installer
	// renvoie une 500 en production alors qu'il fonctionne en local.
	outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
	outputFileTracingIncludes: {
		'/api/recalboxes/[id]/installer': ['../../agent/agent.py', '../../agent/scan_roms.py', '../../agent/VERSION'],
	},
```

Ajouter en tête du fichier :

```ts
import path from 'node:path'
```

- [ ] **Step 7: Vérifier que le build embarque bien les fichiers**

Run:
```bash
cd /home/madjid/projets/recalbox-dashboard && pnpm build
find apps/dashboard/.next/standalone -name 'agent.py' -o -name 'VERSION' | head
```
Expected: au moins un chemin contenant `agent/agent.py`.

**Si rien ne sort** : ne pas passer à la suite. C'est le mode de panne que cette tâche
existe pour attraper. Repli documenté : ajouter à `apps/dashboard/package.json` un
script `"prebuild": "node scripts/copy-agent-payload.mjs"` qui copie les trois fichiers
dans `apps/dashboard/.agent-payload/`, faire pointer `agentDir()` vers ce dossier, et
l'ajouter à `.gitignore`.

- [ ] **Step 8: Commit**

```bash
git add agent/VERSION apps/dashboard/lib/agent/payload.ts apps/dashboard/lib/agent/__tests__/payload.test.ts apps/dashboard/next.config.ts
git commit -m "feat(agent): read the agent payload from server functions"
```

---

### Task 2: Le lanceur et le superviseur minimal

Ce sont les deux fichiers qui atterrissent sur la box. Le script shell est
**délibérément idiot et définitif** : il ne changera plus jamais, parce qu'aucun test ne
peut le couvrir. Toute l'intelligence future (mise à jour, retour arrière) ira dans
`launch.py`, qui est du Python testable.

**Files:**
- Create: `agent/sr-agent[systembrowsing].sh`
- Create: `agent/launch.py`
- Create: `agent/__tests__/test_launch.py`

**Interfaces:**
- Consumes: rien.
- Produces: deux fichiers lus tels quels par le constructeur de zip (Task 3), sous les
  noms `system/sr-agent/launch.py` et `userscripts/sr-agent[systembrowsing].sh`.

- [ ] **Step 1: Écrire le script lanceur**

Créer `agent/sr-agent[systembrowsing].sh` :

```bash
#!/bin/bash
# Super-Retrogamers — lancement de l'agent.
#
# Déposé dans /recalbox/share/userscripts/. EmulationStation exécute tout fichier
# nommé *[systembrowsing].sh à chaque affichage de la liste des systèmes — donc au
# démarrage (deux fois en une seconde, mesuré) et à chaque navigation. La garde
# pgrep n'est donc pas un confort : sans elle, deux agents tournent en parallèle et
# dédoublent les sessions de jeu.
#
# Ce déclenchement répété fait aussi office de chien de garde : un agent mort repart
# au prochain passage au menu.
#
# Le partage est monté en exfat (fmask=0133) : aucun bit d'exécution n'est possible,
# ES lance donc via bash. Ne pas tenter de chmod +x, cela ne peut pas marcher.
AGENT_DIR="/recalbox/share/system/sr-agent"
pgrep -f "$AGENT_DIR/agent.py" >/dev/null 2>&1 && exit 0
nohup python3 "$AGENT_DIR/launch.py" >>"$AGENT_DIR/agent.log" 2>&1 </dev/null &
```

- [ ] **Step 2: Écrire le test qui échoue**

Créer `agent/__tests__/test_launch.py` :

```python
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import launch


class TestAgentPath(unittest.TestCase):
    def test_agent_path_sits_next_to_launcher(self):
        self.assertTrue(launch.agent_path().endswith("agent.py"))
        self.assertEqual(
            os.path.dirname(launch.agent_path()),
            os.path.dirname(os.path.abspath(launch.__file__)),
        )

    def test_build_argv_runs_the_agent_with_the_current_interpreter(self):
        argv = launch.build_argv()
        self.assertEqual(argv[0], sys.executable)
        self.assertTrue(argv[1].endswith("agent.py"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `cd /home/madjid/projets/recalbox-dashboard && python3 -m unittest discover -s agent -v 2>&1 | tail -20`
Expected: FAIL — `ModuleNotFoundError: No module named 'launch'`

- [ ] **Step 4: Implémenter le superviseur minimal**

Créer `agent/launch.py` :

```python
#!/usr/bin/env python3
"""Superviseur de l'agent Super-Retrogamers.

Aujourd'hui il ne fait qu'une chose : lancer agent.py en remplaçant son propre
processus. Il existe séparément du script shell parce que c'est ici qu'arriveront la
mise à jour automatique et le retour arriere — de la logique qui doit etre testable,
ce que du bash sur une box distante n'est pas.
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


def main():
    argv = build_argv()
    # execv remplace le processus courant : pas de processus superviseur qui traine,
    # et le pgrep du script shell continue de voir "agent.py" dans la ligne de commande.
    os.execv(argv[0], argv)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `cd /home/madjid/projets/recalbox-dashboard && timeout 60 python3 -m unittest discover -s agent 2>&1 | tail -5`
Expected: OK — la totalité de la suite (105 tests existants + 2 nouveaux) au vert.

- [ ] **Step 6: Commit**

```bash
git add "agent/sr-agent[systembrowsing].sh" agent/launch.py agent/__tests__/test_launch.py
git commit -m "feat(agent): add the userscripts launcher and its supervisor"
```

---

### Task 3: Le constructeur de zip

**Files:**
- Create: `apps/dashboard/lib/agent/installer-zip.ts`
- Create: `apps/dashboard/lib/agent/__tests__/installer-zip.test.ts`
- Modify: `apps/dashboard/package.json` (dépendance `fflate`)

**Interfaces:**
- Consumes: `readAgentPayload()` (Task 1) — mais la fonction reçoit le contenu en
  paramètre, elle ne lit aucun fichier elle-même. C'est ce qui la rend testable sans
  disque.
- Produces:
  ```ts
  type InstallerInput = {
  	agentPy: string
  	scanRomsPy: string
  	launchPy: string
  	launcherSh: string
  	readme: string
  	config: { recalbox_id: string; token: string; cloud_url: string }
  }
  buildInstallerZip(input: InstallerInput): Uint8Array
  ```

- [ ] **Step 1: Installer la dépendance**

Run: `cd /home/madjid/projets/recalbox-dashboard && pnpm --filter @recalbox/dashboard add fflate`

- [ ] **Step 2: Écrire le test qui échoue**

Créer `apps/dashboard/lib/agent/__tests__/installer-zip.test.ts` :

```ts
import { buildInstallerZip } from '@/lib/agent/installer-zip'
import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

const input = {
	agentPy: '# agent',
	scanRomsPy: '# scan',
	launchPy: '# launch',
	launcherSh: '#!/bin/bash\n',
	readme: 'Bonjour',
	config: { recalbox_id: 'rb-1', token: 'secret-token', cloud_url: 'https://x/api/agent/ingest' },
}

describe('buildInstallerZip', () => {
	it('reproduit exactement l arborescence du partage Recalbox', () => {
		const files = unzipSync(buildInstallerZip(input))
		expect(Object.keys(files).sort()).toEqual([
			'LISEZMOI.txt',
			'system/sr-agent/agent.py',
			'system/sr-agent/config.json',
			'system/sr-agent/launch.py',
			'system/sr-agent/scan_roms.py',
			'userscripts/sr-agent[systembrowsing].sh',
		])
	})

	it('embarque le token et l URL dans un config.json valide', () => {
		const files = unzipSync(buildInstallerZip(input))
		const config = JSON.parse(strFromU8(files['system/sr-agent/config.json']))
		expect(config.token).toBe('secret-token')
		expect(config.recalbox_id).toBe('rb-1')
		expect(config.cloud_url).toBe('https://x/api/agent/ingest')
	})

	it('n invente pas de custom.sh', () => {
		// Le choix de userscripts/ n'a d'intérêt que si l'on ne touche jamais au
		// fichier unique et partagé qu'est custom.sh.
		const files = unzipSync(buildInstallerZip(input))
		expect(Object.keys(files).some((p) => p.includes('custom.sh'))).toBe(false)
	})

	it('recopie le contenu des fichiers Python sans le modifier', () => {
		const files = unzipSync(buildInstallerZip(input))
		expect(strFromU8(files['system/sr-agent/agent.py'])).toBe('# agent')
	})
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/installer-zip.test.ts`
Expected: FAIL — `Cannot find module '@/lib/agent/installer-zip'`

- [ ] **Step 4: Implémenter le constructeur**

Créer `apps/dashboard/lib/agent/installer-zip.ts` :

```ts
import { strToU8, zipSync } from 'fflate'

export type InstallerInput = {
	agentPy: string
	scanRomsPy: string
	launchPy: string
	launcherSh: string
	readme: string
	config: { recalbox_id: string; token: string; cloud_url: string }
}

/** Dossier de l'agent sur la box, relatif à la racine du partage. */
const AGENT_DIR = 'system/sr-agent'
/** Nom du lanceur : la partie entre crochets est l'évènement ES qui le déclenche. */
const LAUNCHER = 'userscripts/sr-agent[systembrowsing].sh'

/**
 * Assemble le zip d'installation.
 *
 * L'arborescence du zip reproduit celle du partage Recalbox pour que le geste de
 * l'utilisateur soit UNIQUE : il sélectionne `system` et `userscripts` et les dépose
 * à la racine de \\RECALBOX\share. Windows fusionne les dossiers de même nom et ne
 * remplace que les fichiers de même nom — or aucun des nôtres n'entre en collision.
 * Toute modification de ces chemins doit préserver cette propriété.
 */
export function buildInstallerZip(input: InstallerInput): Uint8Array {
	return zipSync(
		{
			[`${AGENT_DIR}/agent.py`]: strToU8(input.agentPy),
			[`${AGENT_DIR}/scan_roms.py`]: strToU8(input.scanRomsPy),
			[`${AGENT_DIR}/launch.py`]: strToU8(input.launchPy),
			[`${AGENT_DIR}/config.json`]: strToU8(`${JSON.stringify(input.config, null, 2)}\n`),
			[LAUNCHER]: strToU8(input.launcherSh),
			'LISEZMOI.txt': strToU8(input.readme),
		},
		{ level: 6 },
	)
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run lib/agent/__tests__/installer-zip.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/agent/installer-zip.ts apps/dashboard/lib/agent/__tests__/installer-zip.test.ts apps/dashboard/package.json pnpm-lock.yaml
git commit -m "feat(agent): build the installer zip mirroring the Recalbox share"
```

---

### Task 4: Le point de téléchargement

**Files:**
- Create: `apps/dashboard/app/api/recalboxes/[id]/installer/route.ts`
- Create: `apps/dashboard/app/api/recalboxes/[id]/installer/__tests__/route.test.ts`
- Modify: `apps/dashboard/lib/agent/payload.ts` (ajouter la lecture du lanceur)

**Interfaces:**
- Consumes: `readAgentPayload()` (Task 1), `buildInstallerZip()` (Task 3),
  `createAgentToken(db, recalboxId, name?)` → `{ token, row }`,
  `canControlRecalbox(user, id)`, `getUser()`, `unauthorized()`, `forbidden()`.
- Produces: `GET /api/recalboxes/[id]/installer` → `200 application/zip`.

- [ ] **Step 1: Étendre le payload au lanceur**

Dans `apps/dashboard/lib/agent/payload.ts`, ajouter les deux champs au type et à la
lecture :

```ts
export type AgentPayload = {
	agentPy: string
	scanRomsPy: string
	launchPy: string
	launcherSh: string
	version: string
}
```

et dans `readAgentPayload`, étendre le `Promise.all` :

```ts
	const [agentPy, scanRomsPy, launchPy, launcherSh, version] = await Promise.all([
		readFile(path.join(agentDir(), 'agent.py'), 'utf-8'),
		readFile(path.join(agentDir(), 'scan_roms.py'), 'utf-8'),
		readFile(path.join(agentDir(), 'launch.py'), 'utf-8'),
		readFile(path.join(agentDir(), 'sr-agent[systembrowsing].sh'), 'utf-8'),
		readFile(path.join(agentDir(), 'VERSION'), 'utf-8'),
	])
	return { agentPy, scanRomsPy, launchPy, launcherSh, version: version.trim() }
```

Ajouter les deux nouveaux fichiers à `outputFileTracingIncludes` dans
`next.config.ts` (`'../../agent/launch.py'` et
`'../../agent/sr-agent[systembrowsing].sh'`).

- [ ] **Step 2: Écrire le test qui échoue**

Créer `apps/dashboard/app/api/recalboxes/[id]/installer/__tests__/route.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canControl = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
		forbidden: () => NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({
	canControlRecalbox: (...a: unknown[]) => canControl(...a),
}))
vi.mock('@/lib/config-store', () => ({
	configStore: { getRecalbox: () => ({ id: 'rb-1', name: 'Salon' }) },
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	createAgentToken: async () => ({ token: 'raw-token', row: { id: 'tok-1', name: 'installeur' } }),
}))
vi.mock('@/lib/agent/payload', () => ({
	readAgentPayload: async () => ({
		agentPy: '# agent',
		scanRomsPy: '# scan',
		launchPy: '# launch',
		launcherSh: '#!/bin/bash\n',
		version: '1.0.0',
	}),
}))

import { GET } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }
const req = () => new Request('http://localhost/api/recalboxes/rb-1/installer') as never

beforeEach(() => {
	getUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'member' })
	canControl.mockResolvedValue(true)
})
afterEach(() => {
	getUser.mockReset()
	canControl.mockReset()
})

describe('GET /api/recalboxes/[id]/installer', () => {
	it('401 sans session', async () => {
		getUser.mockResolvedValue(null)
		expect((await GET(req(), ctx as never)).status).toBe(401)
	})

	it('403 pour qui ne contrôle pas la box', async () => {
		canControl.mockResolvedValue(false)
		expect((await GET(req(), ctx as never)).status).toBe(403)
	})

	it('renvoie une archive zip nommée', async () => {
		const res = await GET(req(), ctx as never)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('application/zip')
		expect(res.headers.get('content-disposition')).toContain('.zip')
	})

	it('produit un zip qui contient le token frappé', async () => {
		const { unzipSync, strFromU8 } = await import('fflate')
		const res = await GET(req(), ctx as never)
		const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
		const config = JSON.parse(strFromU8(files['system/sr-agent/config.json']))
		expect(config.token).toBe('raw-token')
	})
})
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run 'app/api/recalboxes/[id]/installer/__tests__/route.test.ts'`
Expected: FAIL — module `../route` introuvable

- [ ] **Step 4: Implémenter la route**

Créer `apps/dashboard/app/api/recalboxes/[id]/installer/route.ts` :

```ts
import { readAgentPayload } from '@/lib/agent/payload'
import { buildInstallerZip } from '@/lib/agent/installer-zip'
import { canControlRecalbox } from '@/lib/auth/ownership'
import { forbidden, getUser, unauthorized } from '@/lib/auth/require-user'
import { configStore } from '@/lib/config-store'
import { db } from '@/lib/db'
import { createAgentToken } from '@/lib/db/agent-queries'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/** Nom de fichier sûr pour l'entête Content-Disposition. */
function slug(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recalbox'
}

export async function GET(req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	// Propriétaire uniquement : le zip contient un token d'agent en clair, donc le
	// lien ne doit jamais être partageable — même pas avec un admin lecteur.
	if (!(await canControlRecalbox(user, id))) return forbidden()

	const rb = configStore.getRecalbox(id)
	if (!rb) return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const payload = await readAgentPayload()
	const { token } = await createAgentToken(db, id, 'installeur')
	const base = (process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, '')

	const zip = buildInstallerZip({
		agentPy: payload.agentPy,
		scanRomsPy: payload.scanRomsPy,
		launchPy: payload.launchPy,
		launcherSh: payload.launcherSh,
		readme: readme(rb.name, payload.version),
		config: { recalbox_id: id, token, cloud_url: `${base}/api/agent/ingest` },
	})

	return new NextResponse(zip as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="recalbox-dashboard-${slug(rb.name)}.zip"`,
			// Le zip embarque un secret à usage unique : ne jamais le laisser en cache.
			'Cache-Control': 'no-store',
		},
	})
}

function readme(boxName: string, version: string): string {
	return [
		`Recalbox Dashboard — installation de l'agent (version ${version})`,
		`Box : ${boxName}`,
		'',
		'1. Ouvrez ce fichier zip.',
		"2. Dans l'explorateur de fichiers, tapez \\\\RECALBOX (Windows)",
		'   ou smb://recalbox (macOS), puis ouvrez le dossier "share".',
		'3. Glissez les dossiers "system" et "userscripts" dans "share".',
		'   Si Windows propose de fusionner, acceptez : rien ne sera écrasé.',
		'4. Redémarrez la Recalbox.',
		'',
		"L'agent démarre tout seul et votre box apparaît dans le dashboard.",
		'Ce fichier contient une clé propre à votre box : ne le partagez pas.',
	].join('\n')
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run 'app/api/recalboxes/[id]/installer/__tests__/route.test.ts'`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/app/api/recalboxes/\[id\]/installer apps/dashboard/lib/agent/payload.ts apps/dashboard/next.config.ts
git commit -m "feat(agent): serve a pre-configured installer zip per Recalbox"
```

---

### Task 5: Le point d'état « ma box a-t-elle appelé ? »

**Files:**
- Create: `apps/dashboard/app/api/recalboxes/[id]/agent-status/route.ts`
- Create: `apps/dashboard/app/api/recalboxes/[id]/agent-status/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `canViewRecalbox(user, id)`, `listAgentTokens(db, id)`.
- Produces: `GET /api/recalboxes/[id]/agent-status` → `{ seen: boolean; lastSeenAt: string | null }`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/dashboard/app/api/recalboxes/[id]/agent-status/__tests__/route.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const canView = vi.fn()
const listAgentTokens = vi.fn()

vi.mock('@/lib/auth/require-user', async () => {
	const { NextResponse } = await import('next/server')
	return {
		getUser: () => getUser(),
		unauthorized: () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
	}
})
vi.mock('@/lib/auth/ownership', () => ({ canViewRecalbox: (...a: unknown[]) => canView(...a) }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/agent-queries', () => ({
	listAgentTokens: (...a: unknown[]) => listAgentTokens(...a),
}))

import { GET } from '../route'

const ctx = { params: Promise.resolve({ id: 'rb-1' }) }

beforeEach(() => {
	getUser.mockResolvedValue({ id: 'u1', email: 'a@b.c', role: 'member' })
	canView.mockResolvedValue(true)
})
afterEach(() => {
	getUser.mockReset()
	canView.mockReset()
	listAgentTokens.mockReset()
})

describe('GET /api/recalboxes/[id]/agent-status', () => {
	it('seen=false tant qu aucun token n a servi', async () => {
		listAgentTokens.mockResolvedValue([{ id: 't1', lastUsedAt: null, revokedAt: null }])
		const body = await (await GET({} as never, ctx as never)).json()
		expect(body.seen).toBe(false)
		expect(body.lastSeenAt).toBeNull()
	})

	it('seen=true dès qu un token a servi', async () => {
		const when = new Date('2026-08-18T20:00:00Z')
		listAgentTokens.mockResolvedValue([{ id: 't1', lastUsedAt: when, revokedAt: null }])
		const body = await (await GET({} as never, ctx as never)).json()
		expect(body.seen).toBe(true)
		expect(body.lastSeenAt).toBe(when.toISOString())
	})

	it('ignore les tokens révoqués', async () => {
		listAgentTokens.mockResolvedValue([
			{ id: 't1', lastUsedAt: new Date(), revokedAt: new Date() },
		])
		expect((await (await GET({} as never, ctx as never)).json()).seen).toBe(false)
	})

	it('404 pour qui ne peut pas voir la box', async () => {
		canView.mockResolvedValue(false)
		expect((await GET({} as never, ctx as never)).status).toBe(404)
	})
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run 'app/api/recalboxes/[id]/agent-status/__tests__/route.test.ts'`
Expected: FAIL — module `../route` introuvable

- [ ] **Step 3: Implémenter la route**

Créer `apps/dashboard/app/api/recalboxes/[id]/agent-status/route.ts` :

```ts
import { canViewRecalbox } from '@/lib/auth/ownership'
import { getUser, unauthorized } from '@/lib/auth/require-user'
import { db } from '@/lib/db'
import { listAgentTokens } from '@/lib/db/agent-queries'
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/**
 * « Cette box a-t-elle déjà appelé ? » — c'est le feu vert de l'écran d'attente de
 * l'assistant. Le signal est le `lastUsedAt` du token, touché à chaque requête de
 * l'agent : le premier appel suffit, on ne cherche pas la fraîcheur ici.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
	const user = await getUser()
	if (!user) return unauthorized()
	const { id } = await params
	if (!(await canViewRecalbox(user, id)))
		return NextResponse.json({ error: 'Not found' }, { status: 404 })

	const tokens = await listAgentTokens(db, id)
	const stamps = tokens.flatMap((t) => (t.revokedAt || !t.lastUsedAt ? [] : [t.lastUsedAt]))
	const last = stamps.reduce<Date | null>(
		(acc, d) => (acc == null || d > acc ? d : acc),
		null,
	)

	return NextResponse.json({ seen: last != null, lastSeenAt: last?.toISOString() ?? null })
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run 'app/api/recalboxes/[id]/agent-status/__tests__/route.test.ts'`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/api/recalboxes/\[id\]/agent-status
git commit -m "feat(agent): expose whether a Recalbox agent has ever checked in"
```

---

### Task 6: Les textes de l'assistant

Tâche séparée parce qu'elle touche deux fichiers volumineux et qu'un relecteur peut
la valider indépendamment du code React qui les consomme.

**Files:**
- Modify: `apps/dashboard/messages/en.json`
- Modify: `apps/dashboard/messages/fr.json`

**Interfaces:**
- Produces: la clé `recalboxes.wizard.*`, consommée par les Tasks 7 et 8.

- [ ] **Step 1: Ajouter le bloc anglais**

Dans `apps/dashboard/messages/en.json`, à l'intérieur de l'objet `recalboxes`
(à côté de `add` et `edit`) :

```json
"wizard": {
  "step": "Step {current} of {total}",
  "nameTitle": "What should we call your Recalbox?",
  "nameHint": "You can change this later.",
  "namePlaceholder": "Living room",
  "next": "Continue",
  "installTitle": "Install it on your Recalbox",
  "download": "Download the installer",
  "downloading": "Preparing…",
  "downloadError": "Could not prepare the installer. Try again.",
  "tabWindows": "Windows",
  "tabMac": "macOS",
  "stepOpen": "Open the file you just downloaded.",
  "stepShareWindows": "In File Explorer, type \\\\RECALBOX in the address bar, then open the \"share\" folder.",
  "stepShareMac": "In Finder, press Cmd+K, type smb://recalbox, then open the \"share\" folder.",
  "stepDrag": "Drag the \"system\" and \"userscripts\" folders into \"share\". If asked to merge, say yes — nothing gets overwritten.",
  "stepReboot": "Restart your Recalbox.",
  "waitTitle": "Waiting for your Recalbox…",
  "waitBody": "As soon as it starts up, it will connect on its own. You can close this page — you'll find it under \"Awaiting setup\".",
  "connected": "Your Recalbox is connected!",
  "goToDashboard": "Open the dashboard",
  "troubleTitle": "Still nothing after a few minutes",
  "troubleReboot": "Did the Recalbox actually restart? The agent only starts on boot.",
  "troubleRoot": "Are \"system\" and \"userscripts\" at the root of \"share\", and not inside another folder?",
  "troubleNet": "Is the Recalbox connected to the internet?",
  "troubleRetry": "Download the installer again",
  "pending": "Awaiting setup",
  "resume": "Finish setup"
}
```

- [ ] **Step 2: Ajouter le bloc français**

Même emplacement dans `apps/dashboard/messages/fr.json` :

```json
"wizard": {
  "step": "Étape {current} sur {total}",
  "nameTitle": "Comment s'appelle ta Recalbox ?",
  "nameHint": "Tu pourras le changer plus tard.",
  "namePlaceholder": "Salon",
  "next": "Continuer",
  "installTitle": "Installe-la sur ta Recalbox",
  "download": "Télécharger l'installeur",
  "downloading": "Préparation…",
  "downloadError": "Impossible de préparer l'installeur. Réessaie.",
  "tabWindows": "Windows",
  "tabMac": "macOS",
  "stepOpen": "Ouvre le fichier que tu viens de télécharger.",
  "stepShareWindows": "Dans l'explorateur de fichiers, tape \\\\RECALBOX dans la barre d'adresse, puis ouvre le dossier « share ».",
  "stepShareMac": "Dans le Finder, fais Cmd+K, tape smb://recalbox, puis ouvre le dossier « share ».",
  "stepDrag": "Glisse les dossiers « system » et « userscripts » dans « share ». Si on te propose de fusionner, accepte : rien n'est écrasé.",
  "stepReboot": "Redémarre ta Recalbox.",
  "waitTitle": "En attente de ta Recalbox…",
  "waitBody": "Dès qu'elle démarre, elle se connecte toute seule. Tu peux fermer cette page : tu la retrouveras dans « En attente d'installation ».",
  "connected": "Ta Recalbox est connectée !",
  "goToDashboard": "Ouvrir le dashboard",
  "troubleTitle": "Toujours rien après quelques minutes",
  "troubleReboot": "La Recalbox a-t-elle vraiment redémarré ? L'agent ne démarre qu'au démarrage.",
  "troubleRoot": "Les dossiers « system » et « userscripts » sont-ils bien à la racine de « share », et pas dans un sous-dossier ?",
  "troubleNet": "La Recalbox a-t-elle accès à Internet ?",
  "troubleRetry": "Retélécharger l'installeur",
  "pending": "En attente d'installation",
  "resume": "Terminer l'installation"
}
```

- [ ] **Step 3: Vérifier que les deux fichiers restent du JSON valide et de même forme**

Run:
```bash
cd /home/madjid/projets/recalbox-dashboard/apps/dashboard && node -e "
const en=require('./messages/en.json'), fr=require('./messages/fr.json')
const a=Object.keys(en.recalboxes.wizard).sort(), b=Object.keys(fr.recalboxes.wizard).sort()
if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error('cles desynchronisees')
console.log('ok', a.length, 'cles')"
```
Expected: `ok 26 cles`

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/messages/en.json apps/dashboard/messages/fr.json
git commit -m "feat(i18n): add the Recalbox setup wizard copy"
```

---

### Task 7: L'assistant

**Files:**
- Create: `apps/dashboard/components/recalboxes/setup-wizard.tsx`
- Create: `apps/dashboard/components/recalboxes/__tests__/setup-wizard.test.tsx`
- Modify: `apps/dashboard/app/[locale]/recalboxes/add/page.tsx`

**Interfaces:**
- Consumes: `useServerless()`, `GET /api/recalboxes/[id]/installer` (Task 4),
  `GET /api/recalboxes/[id]/agent-status` (Task 5), `recalboxes.wizard.*` (Task 6).
- Produces: `<SetupWizard startAt?: 'name' | 'install' | 'wait'; recalboxId?: string />`.

Le composant est piloté par un état à trois valeurs. L'écran d'attente interroge
`agent-status` toutes les 5 secondes et bascule sur le panneau de dépannage au bout de
3 minutes. Il n'y a **aucun blocage** : chaque écran est atteignable directement via
`startAt`, ce qui permet à la liste des box de ramener l'utilisateur à l'écran 2 ou 3.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `apps/dashboard/components/recalboxes/__tests__/setup-wizard.test.tsx` :

```tsx
import { SetupWizard } from '@/components/recalboxes/setup-wizard'
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import messages from '@/messages/fr.json'

function renderAt(props: Parameters<typeof SetupWizard>[0]) {
	return render(
		<NextIntlClientProvider locale="fr" messages={messages}>
			<SetupWizard {...props} />
		</NextIntlClientProvider>,
	)
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe('SetupWizard', () => {
	it('affiche l écran d attente quand on y entre directement', () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ seen: false, lastSeenAt: null })),
		))
		renderAt({ startAt: 'wait', recalboxId: 'rb-1' })
		expect(screen.getByText(messages.recalboxes.wizard.waitTitle)).toBeInTheDocument()
	})

	it('bascule au vert dès que la box a appelé', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ seen: true, lastSeenAt: '2026-08-18T20:00:00Z' })),
		))
		renderAt({ startAt: 'wait', recalboxId: 'rb-1' })
		await waitFor(() =>
			expect(screen.getByText(messages.recalboxes.wizard.connected)).toBeInTheDocument(),
		)
	})

	it('déroule le dépannage au bout de trois minutes sans réponse', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ seen: false, lastSeenAt: null })),
		))
		renderAt({ startAt: 'wait', recalboxId: 'rb-1' })
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 1000)
		await waitFor(() =>
			expect(screen.getByText(messages.recalboxes.wizard.troubleTitle)).toBeInTheDocument(),
		)
	})

	it('arrête d interroger le serveur une fois la box vue', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ seen: true, lastSeenAt: '2026-08-18T20:00:00Z' })),
		)
		vi.stubGlobal('fetch', fetchMock)
		renderAt({ startAt: 'wait', recalboxId: 'rb-1' })
		await waitFor(() =>
			expect(screen.getByText(messages.recalboxes.wizard.connected)).toBeInTheDocument(),
		)
		const callsAfterConnect = fetchMock.mock.calls.length
		await vi.advanceTimersByTimeAsync(30_000)
		expect(fetchMock.mock.calls.length).toBe(callsAfterConnect)
	})
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run components/recalboxes/__tests__/setup-wizard.test.tsx`
Expected: FAIL — module `@/components/recalboxes/setup-wizard` introuvable

**Si l'erreur porte sur `@testing-library/react` ou sur l'environnement DOM** : vérifier
`vitest.config.ts`. Si aucun test de composant n'existe encore dans le dépôt, ajouter
`environment: 'jsdom'` et installer `@testing-library/react`, `@testing-library/jest-dom`
et `jsdom` en devDependencies, puis relancer.

- [ ] **Step 3: Implémenter l'assistant**

Créer `apps/dashboard/components/recalboxes/setup-wizard.tsx`. Points structurants :

```tsx
'use client'

const POLL_MS = 5_000
const TROUBLE_AFTER_MS = 3 * 60 * 1000

type Screen = 'name' | 'install' | 'wait'

export function SetupWizard({
	startAt = 'name',
	recalboxId: initialId,
}: {
	startAt?: Screen
	recalboxId?: string
}) {
	// … état local : screen, recalboxId, name, emoji, os ('windows' | 'mac'), seen, elapsed
}
```

Comportements exigés par les tests :

1. **Écran 1** — champ nom + emoji ; à la validation, `POST /api/recalboxes` avec
   `{ name, iconEmoji, host: 'recalbox.local', sshUser: 'root', sshPassword: '',
   sshPort: 22, mqttPort: 1883 }`, puis mémoriser l'`id` renvoyé et passer à
   l'écran 2. En cas d'échec, afficher le message renvoyé par l'API (elle renvoie
   désormais une phrase lisible dans `error`).
2. **Écran 2** — bouton qui ouvre `/api/recalboxes/${recalboxId}/installer` ; onglets
   Windows/macOS présélectionnés via
   `navigator.userAgent.includes('Mac') ? 'mac' : 'windows'` ; les quatre étapes
   `stepOpen`, `stepShareWindows`/`stepShareMac`, `stepDrag`, `stepReboot` ; puis un
   bouton vers l'écran 3.
3. **Écran 3** — un `setInterval` de `POLL_MS` sur
   `GET /api/recalboxes/${recalboxId}/agent-status`. Dès que `seen` est vrai :
   **arrêter l'intervalle** (le quatrième test l'exige explicitement), afficher
   `connected` et le bouton vers le dashboard. Un second minuteur affiche le panneau
   `troubleTitle` + les trois causes au bout de `TROUBLE_AFTER_MS`. Nettoyer les deux
   minuteurs au démontage.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run components/recalboxes/__tests__/setup-wizard.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Brancher l'assistant sur la page d'ajout**

Modifier `apps/dashboard/app/[locale]/recalboxes/add/page.tsx` pour rendre
`<SetupWizard />` quand `useServerless()` est vrai, et conserver **à l'identique** le
`<RecalboxForm>` actuel sinon. Le mode auto-hébergé ne doit rien perdre.

- [ ] **Step 6: Vérifier que rien n a régressé**

Run: `cd apps/dashboard && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: toute la suite au vert, aucune erreur de type.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/components/recalboxes apps/dashboard/app/\[locale\]/recalboxes/add/page.tsx
git commit -m "feat(recalboxes): guided setup wizard for serverless enrollment"
```

---

### Task 8: La box en attente dans la liste

Sans cette tâche, quitter l'assistant à l'écran 2 laisse une box muette et sans issue.
C'est elle qui tient la promesse « l'écran d'attente est un état, pas une étape ».

**Files:**
- Modify: `apps/dashboard/app/[locale]/recalboxes/page.tsx`
- Create: `apps/dashboard/app/[locale]/recalboxes/__tests__/pending.test.tsx`

**Interfaces:**
- Consumes: `GET /api/recalboxes/[id]/agent-status` (Task 5),
  `recalboxes.wizard.pending` / `.resume` (Task 6), `isServerlessMode()`.

- [ ] **Step 1: Écrire le test qui échoue**

Le test rend la liste avec deux box — l'une jamais vue, l'autre vue — et vérifie que
seule la première porte l'étiquette `pending` et le lien `resume`, et qu'en mode
serverless la ligne `host · SSH · MQTT` n'apparaît pour aucune des deux.

```tsx
it('étiquette la box jamais vue et lui offre une reprise', async () => {
	// … rendu avec agent-status renvoyant seen:false pour rb-1, seen:true pour rb-2
	expect(screen.getByText(messages.recalboxes.wizard.pending)).toBeInTheDocument()
	expect(screen.getByRole('link', { name: messages.recalboxes.wizard.resume })).toHaveAttribute(
		'href',
		expect.stringContaining('rb-1'),
	)
})

it('masque les informations SSH/MQTT en mode serverless', () => {
	// … rendu en mode serverless
	expect(screen.queryByText(/SSH:22/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/dashboard && pnpm exec vitest run 'app/[locale]/recalboxes/__tests__/pending.test.tsx'`
Expected: FAIL — l'étiquette n'existe pas

- [ ] **Step 3: Implémenter**

Dans `apps/dashboard/app/[locale]/recalboxes/page.tsx` :

1. Récupérer l'état d'agent de chaque box.
2. Pour une box jamais vue, afficher l'étiquette `wizard.pending` et un lien
   `wizard.resume` vers l'assistant à l'écran d'installation.
3. Entourer la ligne `{rb.host} · SSH:{rb.sshPort} · MQTT:{rb.mqttPort}` d'une garde
   `!serverless` — en serverless ces trois valeurs sont inertes et donc trompeuses.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/dashboard && pnpm exec vitest run 'app/[locale]/recalboxes/__tests__/pending.test.tsx'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/\[locale\]/recalboxes
git commit -m "feat(recalboxes): surface boxes still awaiting agent setup"
```

---

### Task 9: Recette de bout en bout sur une vraie box

Aucun test automatisé ne prouve que le geste fonctionne. Celui-ci si — et c'est le seul
qui compte. À dérouler **manuellement**, sur une Recalbox réelle.

**Files:** aucun (validation).

- [ ] **Step 1: Sauvegarder l'installation existante de la box de test**

```bash
sshpass -p "$PW" ssh root@recalbox.local \
  'cp -a /recalbox/share/system/sr-agent /recalbox/share/system/sr-agent.bak 2>/dev/null; \
   cp /recalbox/share/system/custom.sh /recalbox/share/system/custom.sh.bak 2>/dev/null; echo ok'
```

- [ ] **Step 2: Dérouler le parcours en se mettant à la place de l'utilisateur**

Depuis un navigateur : ajouter une box via l'assistant, télécharger le zip, l'ouvrir,
atteindre le partage par `\\RECALBOX` (ou `smb://recalbox`), y glisser `system` et
`userscripts`, redémarrer la box. **Ne pas utiliser SSH** : tout l'objet de la recette
est de vérifier que le chemin non technique suffit.

- [ ] **Step 3: Constater le passage au vert**

L'écran d'attente doit basculer sur `connected` sans intervention, en moins de deux
minutes après le démarrage de la box.

- [ ] **Step 4: Vérifier qu'un seul agent tourne**

```bash
sshpass -p "$PW" ssh root@recalbox.local 'pgrep -af "agent.py" | wc -l'
```
Expected: `1`. Une valeur de 2 signifie que la garde `pgrep` n'a pas joué et que les
sessions vont être dédoublées — bloquant.

- [ ] **Step 5: Vérifier que `custom.sh` est intact**

```bash
sshpass -p "$PW" ssh root@recalbox.local \
  'diff /recalbox/share/system/custom.sh /recalbox/share/system/custom.sh.bak && echo INTACT'
```
Expected: `INTACT`. C'est la promesse centrale du choix `userscripts/`.

- [ ] **Step 6: Vérifier qu'une partie est bien enregistrée**

Lancer un jeu sur la box, y jouer plus de 10 secondes, quitter. La session doit
apparaître dans le dashboard.

- [ ] **Step 7: Consigner le résultat**

Ajouter une section « Recette du <date> » à la spec avec les résultats des étapes 3 à
6, puis commit.

---

## Auto-relecture

**Couverture de la spec :** pièce A → Tasks 1, 3, 4 ; pièce B → Task 2 ; pièce C →
Tasks 5, 6, 7, 8. Pièces D et E → hors périmètre, second plan (annoncé en tête).
Sécurité : le propriétaire seul télécharge (Task 4, testé), `Cache-Control: no-store`
(Task 4), `custom.sh` jamais touché (Tasks 2 et 3, testé, revérifié en Task 9).

**Points laissés ouverts, volontairement et explicitement :**

- Task 1 étape 7 peut échouer selon le comportement de traçage de Next 16. Le repli
  est écrit dans la tâche même, pas laissé à l'improvisation.
- Task 7 étape 2 peut révéler qu'aucun test de composant React n'existe encore dans ce
  dépôt. La marche à suivre est écrite dans la tâche.

**Cohérence des noms :** `readAgentPayload` (Tasks 1, 4), `buildInstallerZip` (Tasks 3,
4), `AGENT_DIR`/`LAUNCHER` (Task 3), `agent-status` (Tasks 5, 7, 8),
`recalboxes.wizard.*` (Tasks 6, 7, 8). Le type `AgentPayload` gagne deux champs en
Task 4 — c'est une extension, déclarée dans la tâche.
