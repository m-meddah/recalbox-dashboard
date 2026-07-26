# Audit ROM — lot 2C : arcade, incrémentalité du scan, deep verify

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** couvrir les systèmes arcade (MAME, FBNeo, Neo Geo), rendre les rescans quasi gratuits, et offrir la vérification profonde d'un titre CHD ou RVZ à la demande.

**Architecture:** trois chantiers indépendants qui partagent le socle des lots 1, 2A et 2B. L'arcade demande un dialecte de parsing et un mode de hachage supplémentaires ; l'incrémentalité passe un cache au scanner par le stdin de l'exec ; le deep verify s'exécute sur l'hôte dashboard, jamais sur la box.

**Tech Stack:** TypeScript, Zod, Vitest, Python 3 stdlib (agent), `chdman` (paquet `mame-tools`), `dolphin-tool` (paquet Dolphin) — les deux détectés à l'exécution, jamais requis.

## Note de méthode

Comme aux lots 2A et 2B : le code de test est autoritatif pour la logique dont l'erreur est silencieuse (tâches 1 à 4), et les tâches de câblage (5 et 6) donnent les noms et l'intention de chaque test, à charge de l'implémenteur d'en écrire le corps. Un test manquant de cette liste est un manquement au contrat.

## Ce que la mesure a changé avant d'écrire ce plan

Quatre relevés faits sur le vrai matériel et les vrais catalogues, le 2026-07-26. Ils redéfinissent le lot, et deux d'entre eux contredisent des affirmations écrites dans les documents précédents.

**1. Le parser en streaming est inutile — le spec se trompait.** Le spec exigeait un parsing en streaming au motif qu'« un DAT MAME dépasse largement le Mo et ne doit pas être chargé d'un bloc ». Mesuré : `MAME.dat` fait 6,4 Mo et se parse **en 132 ms avec +11 Mo de tas**. `FBNeo` : 1,7 Mo, 35 ms, +4 Mo. Sur une route serverless comme sur l'hôte, c'est négligeable. **Ce chantier est retiré du lot**, et le spec est corrigé en conséquence (tâche 1).

**2. Le vrai blocage MAME est le dialecte, pas la taille.** Le parser actuel rend **30 038 jeux et 0 ROM** sur `MAME.dat`. Les DAT arcade n'entourent pas leurs valeurs de guillemets :

```text
No-Intro : rom ( name "2020 Super Baseball (Japan).sfc" size 1572864 crc E95A3DD7 ... )
MAME     : rom ( name 005.zip size 29769 crc D123FE67 md5 64ba2c18... sha1 aeebfd4a... )
FBNeo    : rom ( name 88games.zip size 758474 crc C1544E79 ... )
```

Le champ `version` subit le même sort (`version 2017-02-14`, non quoté → lu comme vide).

**3. Les DAT arcade hashent le conteneur, pas son contenu.** Vérifié : **30 038 entrées ROM sur 30 038** de `MAME.dat` portent un nom en `.zip`, et FBNeo fait de même. Notre scanner lit le CRC **interne** des zips — la bonne stratégie pour No-Intro, inopérante ici. L'arcade exige un mode « hacher le fichier conteneur ».

**4. Le blocage de transport que le lot 2B déclarait bloquant n'existe pas.** La note de dette du 2B affirmait qu'aucun canal ne pouvait porter un cache d'incrémentalité vers la box, la ligne de commande plafonnant à 8 Ko. C'était une confusion : **la limite de 8 Ko porte sur la ligne de commande, jamais sur le stdin**. Mesuré sur la box de référence, un programme Python portant un cache compressé en littéral :

| entrées de cache | taille du programme | résultat |
|---|---|---|
| 8 000 | 153 Ko | relu intégralement |
| 40 000 | 764 Ko | relu intégralement |
| 120 000 | 2,3 Mo | relu intégralement |

Le cache de la collection entière tient largement. L'incrémentalité côté scan est donc réalisable, et elle devient nécessaire pour la raison suivante.

**5. L'arcade rend l'incrémentalité indispensable.** Relevé sur la collection :

| système | fichiers `.zip` | volume |
|---|---|---|
| fbneo | 7 713 | 44,9 Go |
| mame | 366 | 8,2 Go |
| neogeo | 139 | 3,9 Go |

Hacher 57 Go de conteneurs à chaque scan, c'est un quart d'heure à une demi-heure de lecture disque, à chaque fois. **L'arcade et l'incrémentalité sont le même problème** : le premier crée le coût, la seconde l'amortit. Ils sont donc dans le même lot.

## Périmètre

**Dans le lot :** dialecte arcade du parser, mode de hachage conteneur, mapping des systèmes arcade, incrémentalité côté scan (SSH et agent), deep verify d'un titre à la demande.

**Retiré du lot, avec justification :** le parser en streaming (mesure ci-dessus). Le spec est amendé.

**Hors lot :** l'import et la réparation de collection, toujours hors périmètre du spec. Le lot reste **strictement en lecture** côté collection : rien n'est téléchargé, rien n'est modifié dans les dossiers de ROMs.

## Global Constraints

- Biome : **tabulations**, guillemets simples, **pas de point-virgule**, virgules finales. Commentaires de code en anglais.
- Tests dans `__tests__/` à côté du code testé. Vitest côté TS, `python3 -m unittest` côté agent.
- **La ligne de commande SSH reste sous 8000 octets.** Le script *et* le cache voyagent sur le **stdin** de l'exec (mesuré jusqu'à 2,3 Mo).
- **Rien n'est écrit dans les dossiers de ROMs.** Le deep verify travaille sur une copie temporaire, sur l'hôte, et la supprime.
- **`chdman` et `dolphin-tool` ne sont jamais requis.** Absents, la fonction se masque et l'audit reste complet.
- **Aucun binaire n'est attendu sur la Recalbox** : RecalboxOS est un Buildroot sans gestionnaire de paquets.
- Les DAT ne vont jamais en base ; aucun appel à ScreenScraper `jeuInfos`.
- Le deep verify est **self-hosted uniquement**, masqué par `isServerlessMode()`.
- Autorisation : lecture derrière `canViewRecalbox`, déclenchement derrière `canControlRecalbox`.
- Commits conventionnels.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `lib/rom-audit/dat-parser.ts` *(modifié)* | Accepte les valeurs non quotées du dialecte arcade |
| `lib/recalbox/system-meta.ts` *(modifié)* | `datSource: 'mame' \| 'fbneo'`, `hashMode` pour les systèmes arcade |
| `lib/rom-audit/system-catalog.ts` *(modifié)* | Expose le mode de hachage au scanner et au matcher |
| `agent/scan_roms.py` *(modifié)* | Mode conteneur ; cache d'incrémentalité |
| `lib/rom-audit/scan-cache.ts` | Construit le cache envoyé au scanner, relit ce qu'il renvoie |
| `lib/rom-audit/scan-runner.ts` *(modifié)* | Fait voyager cache + script sur le stdin |
| `lib/rom-audit/deep-verify.ts` | Détection des binaires, extraction, comparaison au DAT |
| `lib/rom-audit/deep-verify-fetch.ts` | Rapatriement SFTP + contrôle d'espace disque |
| `app/api/rom-audit/verify/route.ts` | Déclenche une vérification profonde sur un titre |
| `components/rom-audit/deep-verify-button.tsx` | Bouton, masqué sans binaire ou en serverless |

---

## Task 1: Le dialecte arcade dans le parser

**Files:**
- Modify: `apps/dashboard/lib/rom-audit/dat-parser.ts`
- Modify: `apps/dashboard/lib/rom-audit/__tests__/dat-parser.test.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/fixtures/mame-excerpt.dat`
- Create: `apps/dashboard/lib/rom-audit/__tests__/fixtures/fbneo-excerpt.dat`
- Modify: `docs/superpowers/specs/2026-07-25-rom-audit-design.md` (amendement)

**Interfaces:** aucune signature ne change. `parseDat(text): Dat` doit simplement cesser de rendre zéro ROM sur un DAT arcade.

- [ ] **Step 1: Poser les fixtures, copiées des vrais fichiers**

Extraire trois jeux réels de `metadat/mame/MAME.dat` et trois de `metadat/fbneo-split/FBNeo - Arcade Games.dat`, en-tête `clrmamepro` compris. **Recopier les octets tels quels** — la leçon de l'offset RVZ du lot 2A est qu'une fixture réécrite à la main encode les mêmes erreurs que le code qu'elle teste. Le premier jeu de MAME est :

```text
game (
	name "005"
	year "1981"
	developer "Sega"
	rom ( name 005.zip size 29769 crc D123FE67 md5 64ba2c1869a491bdae1384d3a95c2027 sha1 aeebfd4a3a6214e6efed19dd4d5716215e253b13 )
)
```

Noter la dissymétrie, qui est le cœur du sujet : `name "005"` du **jeu** est quoté, `name 005.zip` de la **ROM** ne l'est pas.

- [ ] **Step 2: Écrire les tests (autoritatifs)**

À ajouter à `dat-parser.test.ts` :

```ts
describe('arcade dialect', () => {
	// Le parser rendait 30 038 jeux et 0 rom sur le vrai MAME.dat : les valeurs
	// des entrées rom n'y sont pas entre guillemets.
	it('reads an unquoted rom name', () => {
		const dat = parseDat(readFileSync(MAME_FIXTURE, 'utf-8'))
		const first = dat.games[0]
		expect(first?.name).toBe('005')
		expect(first?.roms).toHaveLength(1)
		expect(first?.roms[0]?.name).toBe('005.zip')
		expect(first?.roms[0]?.size).toBe(29769)
	})

	it('reads the hashes of an unquoted rom entry', () => {
		const rom = parseDat(readFileSync(MAME_FIXTURE, 'utf-8')).games[0]?.roms[0]
		expect(rom?.crc).toBe('d123fe67')
		expect(rom?.md5).toBe('64ba2c1869a491bdae1384d3a95c2027')
		expect(rom?.sha1).toBe('aeebfd4a3a6214e6efed19dd4d5716215e253b13')
	})

	// `version 2017-02-14` n'est pas quoté non plus, et se lisait comme vide.
	it('reads an unquoted header version', () => {
		const dat = parseDat(readFileSync(MAME_FIXTURE, 'utf-8'))
		expect(dat.name).toBe('MAME - Consolidated ROM Sets')
		expect(dat.version).toBe('2017-02-14')
	})

	it('reads the fbneo dialect too', () => {
		const dat = parseDat(readFileSync(FBNEO_FIXTURE, 'utf-8'))
		expect(dat.version).toBe('1.0.0.03')
		expect(dat.games[0]?.roms[0]?.name).toBe('88games.zip')
	})

	// Un nom de jeu arcade contient couramment une parenthèse et une apostrophe :
	// « 10-Yard Fight (World, set 1) », « '88 Games ».
	it('keeps a game name holding a comma, a parenthesis and an apostrophe', () => {
		const dat = parseDat(readFileSync(MAME_FIXTURE, 'utf-8'))
		expect(dat.games.map((g) => g.name)).toContain('10-Yard Fight (World, set 1)')
	})

	// Le dialecte No-Intro ne doit rien perdre au passage : c'est la couverture
	// existante qui le prouve, plus ce cas explicite.
	it('still reads a quoted no-intro entry', () => {
		const dat = parseDat(
			'game (\n\tname "Zelda (Europe)"\n\trom ( name "Zelda (Europe).sfc" size 1048576 crc E95A3DD7 )\n)\n',
		)
		expect(dat.games[0]?.roms[0]?.name).toBe('Zelda (Europe).sfc')
	})

	// Un nom non quoté s'arrête au premier espace, sinon il avalerait « size ».
	it('does not swallow the next field into an unquoted name', () => {
		const dat = parseDat('game (\n\tname a\n\trom ( name b.zip size 42 crc AABBCCDD )\n)\n')
		expect(dat.games[0]?.roms[0]?.name).toBe('b.zip')
		expect(dat.games[0]?.roms[0]?.size).toBe(42)
	})
})
```

- [ ] **Step 3: Lancer, constater l'échec**

```bash
cd apps/dashboard && pnpm exec vitest run lib/rom-audit/__tests__/dat-parser.test.ts
```

Attendu : les cas arcade échouent (0 rom, version vide), les cas No-Intro passent déjà.

- [ ] **Step 4: Implémenter**

Généraliser l'extracteur de champ : une valeur est soit `"…"` (tout jusqu'au guillemet fermant, espaces compris), soit une suite de caractères sans espace. Un nom **non** quoté s'arrête au premier blanc — le test du step 2 le fixe explicitement, parce qu'une expression trop gourmande avalerait `size` et sa valeur.

Ne pas toucher à la structure ligne à ligne établie au lot 1 : elle existe parce que compter les parenthèses casse sur `10-Yard Fight (World, set 1)`.

- [ ] **Step 5: Vérifier sur les vrais catalogues, pas seulement sur les fixtures**

Écrire un contrôle jetable qui parse les fichiers complets téléchargés depuis libretro-database et affiche le nombre de jeux, de ROMs et la version. Attendu : `MAME.dat` → 30 038 jeux et **30 038 ROMs** (aujourd'hui 0), version `2017-02-14` ; `FBNeo` → 7 718 jeux, 7 718 ROMs, version `1.0.0.03`. Vérifier aussi qu'un DAT No-Intro (`Sega - Game Gear.dat`) donne exactement les mêmes chiffres qu'avant le changement : **912 entrées ROM**, la valeur mesurée au lot 2A.

- [ ] **Step 6: Amender le spec**

Dans `docs/superpowers/specs/2026-07-25-rom-audit-design.md`, section « Cache des catalogues » : remplacer l'exigence de parsing en streaming par le relevé (6,4 Mo → 132 ms, +11 Mo de tas) et la conclusion qu'un chargement d'un bloc convient. Ajouter à la section « Sources de données » le dialecte arcade et le fait que les DAT MAME/FBNeo hashent le conteneur.

- [ ] **Step 7: Commit**

```bash
git commit -m "fix(rom-audit): lis le dialecte arcade, qui ne quote pas ses valeurs"
```

---

## Task 2: Le mode de hachage conteneur

**Files:**
- Modify: `apps/dashboard/lib/recalbox/system-meta.ts`
- Modify: `apps/dashboard/lib/rom-audit/system-catalog.ts` (+ tests)
- Modify: `agent/scan_roms.py` (+ `agent/__tests__/test_scan_roms.py`)
- Modify: `apps/dashboard/lib/rom-audit/scan-runner.ts`, `scan-batches.ts`

**Interfaces:**

```ts
// system-meta.ts — champs ajoutés
datSource?: 'no-intro' | 'redump' | 'mame' | 'fbneo'
/** 'content' (défaut) hashe la ROM dans l'archive ; 'container' hashe l'archive elle-même. */
hashMode?: 'content' | 'container'

// system-catalog.ts
export type SystemCatalog = {
	source: 'no-intro' | 'redump' | 'mame' | 'fbneo'
	file: string
	hashMode: 'content' | 'container'
	ssConsoleId?: number
}
```

Côté cible de scan, le mode voyage jusqu'au script :

```ts
export type ScanTarget = { mount: string; system: string; romsPath: string; hashMode?: 'content' | 'container' }
// --target <mount>|<system>|<romsPath>|<hashMode>
```

- [ ] **Step 1: Tests Python du mode conteneur**

À ajouter à `agent/__tests__/test_scan_roms.py` :

```python
class ContainerModeTest(unittest.TestCase):
    # Les DAT arcade hashent le .zip lui-même : 30 038 entrées sur 30 038 de
    # MAME.dat portent un nom en .zip. Lire le CRC interne ne matcherait jamais.
    def test_hashes_the_zip_file_itself_not_its_entries(self): ...
    def test_emits_one_entry_per_archive_not_one_per_rom(self): ...
    def test_the_kind_says_container(self): ...
    # Le mode par défaut ne bouge pas : tout le lot 2A en dépend.
    def test_content_mode_still_reads_the_inner_crc(self): ...
    def test_an_unreadable_archive_is_counted_not_fatal(self): ...
    # Un .7z en mode conteneur se hashe aussi comme un fichier, sans 7zr.
    def test_hashes_a_7z_as_a_plain_file_in_container_mode(self): ...
```

Le mode conteneur réutilise `handle_raw` (lecture complète, `zlib.crc32` en streaming) : c'est déjà la stratégie 5 du spec, appliquée au fichier au lieu de son contenu. Le `kind` du manifeste vaut `container`, à ajouter à `ROM_KINDS` côté Zod.

- [ ] **Step 2: Tests TypeScript de la cible et du catalogue**

```ts
describe('catalogForSystem (arcade)', () => {
	it('maps mame to its dat in container mode', () => { /* source 'mame', hashMode 'container' */ })
	it('maps fbneo to its own dat', () => { /* … */ })
	it('defaults every other system to content mode', () => { /* snes, psx */ })
})

describe('buildScanCommand (hash mode)', () => {
	it('passes the hash mode of an arcade target', () => { /* --target …|container */ })
	it('omits it for a content target, keeping the command short', () => { /* … */ })
})
```

- [ ] **Step 3: Implémenter**

Renseigner `mame`, `fbneo` et `neogeo` dans `SYSTEM_META` avec leur `datFile` et `hashMode: 'container'`. **Vérifier chaque nom de fichier contre la liste réelle de libretro-database** avant de l'écrire — c'est la discipline qui a donné 55/55 au lot 1. Les chemins connus au 2026-07-26 sont `metadat/mame/MAME.dat` et `metadat/fbneo-split/FBNeo - Arcade Games.dat` ; `neogeo` est à trancher entre les deux, en comparant les deux catalogues aux 139 archives réelles de la box (étape 5).

Le manifeste gagne le `kind` `container`. `catalog.ts` doit savoir servir la source `fbneo` (nouveau sous-dossier `metadat/fbneo-split/`).

- [ ] **Step 4: Le matcher n'a rien à changer, le vérifier**

Un fichier en mode conteneur porte le CRC de l'archive et son nom de fichier ; le DAT arcade porte le CRC de l'archive et le même nom. `auditSystem` matche donc par hash sans modification. **Ajouter un test qui le prouve** plutôt que de le supposer :

```ts
it('matches an arcade container by the hash of the archive itself', () => { /* … */ })
```

- [ ] **Step 5: Vérifier sur la box, sur un échantillon**

Scanner `neogeo` (139 archives, 3,9 Go — le plus petit des trois) et comparer aux deux catalogues candidats. Attendu : un taux `verified` élevé contre le bon catalogue, proche de zéro contre le mauvais — c'est ce qui tranche le mapping. Relever le temps réel : il sert à dimensionner l'incrémentalité de la tâche 3.

Ne **pas** scanner `fbneo` (44,9 Go) avant que la tâche 3 soit en place.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(rom-audit): hachage du conteneur pour les systemes arcade"
```

---

## Task 3: Incrémentalité côté scan

**Files:**
- Create: `apps/dashboard/lib/rom-audit/scan-cache.ts` (+ tests)
- Modify: `apps/dashboard/lib/rom-audit/scan-runner.ts` (+ tests)
- Modify: `agent/scan_roms.py` (+ tests)
- Modify: `apps/dashboard/lib/rom-audit/scan-service.ts`, `lib/db/rom-audit-queries.ts`

**Interfaces:**

```ts
// scan-cache.ts
/** (size, mtime) → identification déjà connue, indexée par chemin. */
export type ScanCacheEntry = { size: number; mtime: number; crc32?: string; sha1?: string; serial?: string; kind: string; innerName?: string }
export type ScanCache = Record<string, ScanCacheEntry[]>
export function buildScanCache(rows: readonly RomFileRow[]): ScanCache
export function encodeScanCache(cache: ScanCache): string   // zlib + base64, littéral python
export const MAX_CACHE_BYTES: number
```

- [ ] **Step 1: Tests du cache**

```ts
describe('buildScanCache', () => {
	it('indexes the previous scan by path', () => { /* … */ })
	// Une archive 7z donne N lignes pour un seul chemin : le cache doit toutes
	// les rendre, sinon le scanner ne pourrait pas reconstituer ses entrées.
	it('groups every entry of one archive under its path', () => { /* … */ })
	it('carries what identifies a file, not what the audit deduced', () => { /* pas de matchLevel ni de datEntryName */ })
	it('is empty for a system never scanned', () => { /* … */ })
})

describe('encodeScanCache', () => {
	it('produces a python-safe literal', () => { /* base64 only: [A-Za-z0-9+/=] */ })
	it('shrinks a realistic cache by an order of magnitude', () => { /* 8000 entrées : < 300 Ko */ })
	// Mesuré sur la box : 2,3 Mo de stdin passent. La garde protège d'un cas
	// dégénéré, elle ne reflète pas une limite du transport.
	it('refuses a cache beyond the guard rather than sending it', () => { /* … */ })
})
```

- [ ] **Step 2: Tests Python de la réutilisation**

```python
class IncrementalScanTest(unittest.TestCase):
    # Le gain : ne pas relire 57 Go d'archives arcade à chaque passage.
    def test_reuses_the_cached_identification_when_size_and_mtime_match(self): ...
    def test_rehashes_when_the_size_changed(self): ...
    def test_rehashes_when_the_mtime_changed(self): ...
    def test_hashes_a_file_absent_from_the_cache(self): ...
    # Une entrée de cache corrompue ne doit pas produire un faux résultat :
    # dans le doute, on relit le fichier.
    def test_a_malformed_cache_entry_falls_back_to_hashing(self): ...
    def test_counts_the_reused_entries_separately(self): ...
    def test_an_empty_cache_behaves_exactly_like_no_cache(self): ...
```

- [ ] **Step 3: Implémenter**

Le cache voyage **avec le script, sur le stdin** : le programme envoyé est `SCAN_SCRIPT` suivi d'une ligne `CACHE_B64 = "…"`. Mesuré sur la box de référence — 8 000 entrées → 153 Ko, 40 000 → 764 Ko, 120 000 → 2,3 Mo, tous relus intégralement. La ligne de commande, elle, ne bouge pas et reste sous 8 Ko.

Côté Python : décoder le cache au démarrage ; pour chaque fichier, si `(size, mtime)` correspond, réémettre les entrées mémorisées sans lire le contenu ; sinon appliquer la stratégie normale. Compteur `reused` distinct dans les stats.

Côté service : charger les lignes `rom_files` du système avant le scan (`listRomFiles`) et construire le cache. **En mode `aggregates` (serverless) le cache est vide** : seuls les `unknown` y sont stockés, il n'y a rien à réutiliser. C'est une limite assumée, à consigner.

- [ ] **Step 4: Mesurer le gain, sur la box**

Scanner `neogeo` deux fois de suite et relever les deux durées, ainsi que le compteur `reused`. Attendu : la seconde passe réutilise 139 entrées sur 139 et tombe de plusieurs minutes à quelques secondes. **Reporter les deux chiffres dans le registre** : c'est la justification du chantier.

Puis, une fois seulement ce gain constaté, lancer le premier scan `fbneo` (7 713 archives, 44,9 Go) et relever sa durée — c'est la mesure qui manquait au dimensionnement du lot.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(rom-audit): reutilise le scan precedent pour eviter de rehacher"
```

---

## Task 4: Le moteur de deep verify

**Files:**
- Create: `apps/dashboard/lib/rom-audit/deep-verify.ts` (+ tests)
- Create: `apps/dashboard/lib/rom-audit/deep-verify-fetch.ts` (+ tests)

**Interfaces:**

```ts
export type VerifyTool = 'chdman' | 'dolphin-tool'
export type ToolAvailability = { tool: VerifyTool; available: boolean; version?: string }
export async function detectTools(run?: RunCommand): Promise<ToolAvailability[]>

export type VerifyOutcome =
	| { status: 'verified'; sha1: string; datEntryName: string }
	| { status: 'mismatch'; sha1: string }
	| { status: 'corrupt'; detail: string }
	| { status: 'unsupported'; reason: string }
	| { status: 'tool-missing'; tool: VerifyTool }
	| { status: 'no-space'; requiredBytes: number; freeBytes: number }
	| { status: 'failed'; reason: string }

export async function verifyTitle(input: VerifyInput, deps: VerifyDeps): Promise<VerifyOutcome>
```

- [ ] **Step 1: Tests de la détection et du verdict**

Le module est injectable (`RunCommand`, `Fetcher`, `FreeSpace`) : aucun test n'exige `chdman`, absent de la machine de développement comme de la box.

```ts
describe('detectTools', () => {
	it('reports a tool as available with its version', () => { /* … */ })
	it('reports a missing binary without throwing', () => { /* ENOENT */ })
	it('never lets a tool crash count as available', () => { /* code 127 */ })
})

describe('verifyTitle', () => {
	it('confirms a chd whose recomputed sha1 matches the dat', () => { /* … */ })
	it('reports a mismatch when the hash differs from every dat entry', () => { /* … */ })
	// La valeur propre du deep verify : même sans correspondance Redump, il
	// détecte un fichier corrompu, ce que rien d'autre dans l'audit ne fait.
	it('reports corruption when chdman fails its own internal check', () => { /* … */ })
	it('refuses before copying anything when the tool is missing', () => { /* aucun fetch */ })
	// Une extraction CHD produit un temporaire de la taille du disque décompressé.
	it('refuses before copying when the host has too little free space', () => { /* … */ })
	it('deletes the temporary file on success', () => { /* … */ })
	it('deletes the temporary file on failure too', () => { /* … */ })
	it('never throws, whatever the tool prints', () => { /* sortie vide, binaire tué */ })
	it('rejects a kind it cannot verify', () => { /* zip-entry → unsupported */ })
})
```

- [ ] **Step 2: Tests du rapatriement**

```ts
describe('fetchForVerify', () => {
	it('asks the box for the file size before deciding', () => { /* … */ })
	it('writes into a temp dir outside the project', () => { /* … */ })
	// Le chemin vient de la base, donc de la box : il ne doit jamais pouvoir
	// désigner autre chose qu'un fichier de /recalbox/share.
	it('refuses a path outside the share', () => { /* … */ })
	it('refuses a path holding a parent segment', () => { /* … */ })
})
```

- [ ] **Step 3: Implémenter**

`detectTools` exécute `chdman --help` / `dolphin-tool --version` et interprète l'absence comme une indisponibilité, jamais comme une erreur. Le rapatriement passe par `getFile` de `node-ssh` (SFTP, vérifié disponible en 13.2.1). L'espace libre se contrôle avant la copie **et** avant l'extraction, avec une marge : `chdman extractcd` produit un fichier de la taille du disque décompressé, jusqu'à ~700 Mo pour un CD et davantage pour un DVD.

Le temporaire est supprimé dans un `finally`, y compris sur échec — un CD par vérification suffit à saturer un disque en quelques essais.

- [ ] **Step 4: Vérifier avec le vrai binaire, si l'hôte l'accepte**

`chdman` **est installé** depuis le 2026-07-27 (`mame-tools`, `/usr/bin/chdman` 0.285). Vérifier un vrai CHD de la collection de bout en bout : rapatriement, extraction, comparaison. Le chemin « binaire absent » reste couvert par les tests, puisque le lot doit fonctionner sans lui.

`dolphin-tool` est livré par le paquet `dolphin-emu`, dans **`/usr/games/dolphin-tool`** — vérifié le 2026-07-27 en listant le contenu du `.deb`. La détection ne doit donc pas se contenter d'un `which` : `/usr/games` n'est pas dans le PATH de tous les contextes d'exécution, et c'est exactement ce qui m'avait fait conclure à tort à son absence. Chercher le binaire par chemin explicite en plus du PATH.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(rom-audit): moteur de verification profonde cote hote"
```

---

## Task 5: Route et bouton de deep verify

**Files:**
- Create: `apps/dashboard/app/api/rom-audit/verify/route.ts` (+ tests)
- Create: `apps/dashboard/components/rom-audit/deep-verify-button.tsx`
- Modify: `apps/dashboard/components/rom-audit/audit-system-detail.tsx`
- Modify: `apps/dashboard/messages/en.json`, `messages/fr.json`

- [ ] **Step 1: La route**

`POST /api/rom-audit/verify`, corps `{ recalboxId, entryKey }` validé par Zod. Séquence : `getUser` → 401 ; `canControlRecalbox` → 403 (la vérification consomme du disque et de la bande passante) ; **`isServerlessMode()` → 409** avec une raison lisible ; ligne `rom_files` introuvable → 404 ; sinon `verifyTitle`.

`GET /api/rom-audit/verify` renvoie la disponibilité des binaires, pour que l'UI sache masquer le bouton.

Tests : 401, 403, 409 en serverless, 404 sur entrée inconnue, verdict rendu tel quel, et **aucun rapatriement déclenché quand le binaire manque**.

- [ ] **Step 2: Le bouton**

Visible seulement pour un `kind` `chd` ou `rvz`, seulement en self-hosted, seulement si le binaire correspondant est disponible. Affiche l'attente (l'opération dure de dix secondes à une minute sur un LAN gigabit) puis le verdict, distinctement pour « vérifié », « écart au catalogue » et « fichier corrompu » — les trois ne veulent pas dire la même chose.

- [ ] **Step 3: i18n**

Section `romAudit.verify` dans `en.json` **et** `fr.json`, mêmes clés des deux côtés, y compris les messages d'indisponibilité (binaire absent, mode serverless, espace insuffisant).

- [ ] **Step 4: Vérifier**

```bash
cd apps/dashboard && pnpm exec vitest run && pnpm exec tsc --noEmit
cd ../.. && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(rom-audit): verification profonde d un titre depuis l interface"
```

---

## Recette finale

- [ ] `neogeo` scanné en mode conteneur : taux `verified` élevé contre le bon catalogue, et **quasi nul contre l'autre** — c'est ce qui prouve le mapping plutôt que de l'affirmer.
- [ ] `fbneo` scanné une première fois (7 713 archives, 44,9 Go) : durée relevée, zéro erreur.
- [ ] Second scan de `fbneo` : le compteur `reused` couvre la quasi-totalité des archives et la durée s'effondre. Les deux chiffres vont au registre.
- [ ] Un système No-Intro déjà audité (`gamegear`) rescanné : **exactement** 808 entrées, 804 `verified`, 77 jeux manquants — les valeurs des lots 2A et 2B. Toute dérive ici signale une régression du parser.
- [ ] Deep verify sur un vrai CHD, si `chdman` est installé ; sinon, bouton masqué et audit complet malgré tout.

## Dette et limites connues à la sortie du lot

- **Pas de cache d'incrémentalité en serverless** : le cloud ne stocke que les `unknown`, il n'a donc rien à renvoyer au scanner. Un scan par agent relit tout à chaque fois. Piste pour plus tard : un cache local à l'agent, dans son propre dossier.
- ~~**`dolphin-tool` n'est pas empaqueté**~~ — **correction du 2026-07-27 : il l'est.** Le
  paquet `dolphin-emu` (2512+dfsg-3) livre `/usr/games/dolphin-tool`. Mon relevé initial
  concluait le contraire parce que `which` et `apt-cache search dolphin-tool` ne voient pas
  `/usr/games/`. Le deep verify RVZ est donc réalisable ; reste à décider d'installer le
  paquet (21 Mo, plus ses dépendances Qt).
- L'avertissement de traçage de fichiers sur `lib/storage/index.ts` (via `/api/blob`), relevé au lot 2B, est **antérieur** à ces lots et toujours ouvert.
