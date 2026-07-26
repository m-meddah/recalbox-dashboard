# Audit de collection ROMs — Plan 2A : le scan on-box

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produire un manifeste de scan réel depuis une Recalbox — tous supports, cinq stratégies d'identification — et le brancher sur le noyau d'audit livré par le plan 1.

**Architecture:** Un script Python autonome tourne sur la box et écrit un manifeste JSON sur sa sortie standard. Côté serveur, trois modules purs l'encadrent : choix des cibles à scanner, génération de la commande, assemblage et validation du résultat. Le transport SSH est le seul point d'I/O.

**Tech Stack:** TypeScript, Vitest 2, Zod 4, Python 3 (présent sur RecalboxOS), `node-ssh` via le `SshPool` existant.

Spec de référence : [`docs/superpowers/specs/2026-07-25-rom-audit-design.md`](../specs/2026-07-25-rom-audit-design.md)
Plan précédent : [`docs/superpowers/plans/2026-07-25-rom-audit-core.md`](2026-07-25-rom-audit-core.md)

## Note de méthode — lire avant de commencer

Le plan 1 pré-écrivait l'implémentation de chaque tâche. **Six snippets sur sept se sont révélés fautifs** et ont coûté une passe de correction chacun : regex non ancrée corrompant une donnée, algorithme incapable de satisfaire son propre test, validation trop laxiste, 36 erreurs de typage, compte de fixture désynchronisé, ordre écriture/retour du cache.

Ce plan change donc de contrat, délibérément :

- **Le code des tests est donné en entier et fait autorité.** Il décrit le comportement attendu ; on ne l'affaiblit pas, on ne le contourne pas.
- **L'implémentation est spécifiée, pas transcrite** : interfaces exactes, algorithme, valeurs et invariants. À l'implémenteur de l'écrire pour satisfaire les tests.
- Les **données vérifiées** (offsets binaires, noms de champs, sorties de commandes) sont reproduites telles quelles : ce sont des faits mesurés, pas des suggestions.

Si un test fourni paraît impossible à satisfaire, c'est un défaut du plan : **arrête-toi et pose la question** plutôt que de contourner. Trois fois sur le plan 1, c'est ce qui a évité un bug.

## Global Constraints

- Branche de travail : `feat/rom-audit` (contient le plan 1, 37 commits).
- Style Biome : **tabulations**, guillemets **simples**, **pas de point-virgule**, virgules finales.
- Tests dans `__tests__/` ; fixtures dans `__tests__/__fixtures__/`.
- Toutes les commandes se lancent depuis `apps/dashboard/`, **préfixées de `rtk proxy`** (un hook local casse `pnpm exec` en direct).
- Le dépôt est à **zéro erreur TypeScript** et **929 tests verts** — les deux doivent le rester.
- `pnpm exec biome check` doit rester propre.
- Aucun test ni aucune fixture existants ne doivent être supprimés ou affaiblis.
- **Le script Python ne prend aucune dépendance** : stdlib seule. RecalboxOS embarque Python 3.11.8, sans gestionnaire de paquets.
- **Rien n'est écrit sur la Recalbox.** Ce lot est en lecture seule.
- Aucune table, aucune migration, aucun accès base : la persistance est le plan 2B.

## Faits vérifiés sur la box de référence

Relevé le 2026-07-26, Recalbox 10.1-patron-1, aarch64, Python 3.11.8.

**Binaires** : `python3` ✓, `/usr/bin/7zr` ✓, `unzip` ✓, `chdman` ✗, `dolphin-tool` ✗.

**Supports renvoyés par `fetchStorageInfo`** (tag `recalbox: 'share'`) :

```text
/recalbox/share                  120 Go   carte SD
/recalbox/share/externals/usb0   4,0 To
/recalbox/share/externals/usb1   4,0 To
```

`/recalbox/share` est un **préfixe** des deux autres : le rattachement d'un fichier à son support exige la règle du préfixe le plus long.

**Volumétrie** : usb0 = 126 systèmes / 230 666 fichiers ; usb1 = 119 systèmes / 46 682 fichiers ; carte SD = squelette de dossiers quasi vide.

**Répartition des extensions sur usb0** — la majorité des fichiers ne sont pas des ROMs :

```text
114 805 png    34 900 mp4    22 527 7z     14 594 zip
 12 089 chd    11 584 pdf     7 675 dsk     2 896 md
  1 636 rvz (usb1)            1 271 d64       953 txt
```

**`7zr` mesuré** : 40 archives listées en 1,8 s, soit ~45 ms l'unité. CRC annoncé identique au CRC recalculé après extraction. Une minorité d'archives contiennent des `.zip` plutôt que des ROMs nues (1 sur 25 échantillonnées).

## File Structure

| Fichier | Responsabilité |
|---|---|
| `lib/rom-audit/scan-targets.ts` | Pur. Supports + dossiers `/roms` → liste de cibles ; rattachement d'un chemin à son support |
| `lib/rom-audit/scan-script.ts` | Pur. Porte la source Python et compose la commande shell |
| `agent/scan_roms.py` | Le script Python lui-même, autonome et testable seul |
| `lib/rom-audit/scan-runner.ts` | Seul point d'I/O. Exécute via SSH, assemble et valide le manifeste |
| `scripts/rom-audit.ts` | Étendu : peut scanner une vraie box au lieu de lire un manifeste fabriqué |

---

### Task 1: Cibles de scan et rattachement au support

**Files:**
- Create: `apps/dashboard/lib/rom-audit/scan-targets.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/scan-targets.test.ts`

**Interfaces:**
- Consumes: `StorageMount` de `@/lib/recalbox/storage` — `{ label, mount, usedBytes, sizeBytes, percent }`.
- Produces, consommés par les tâches 2, 3 et 4 :

```ts
export type ScanTarget = { mount: string; system: string; romsPath: string }
export function romsRootFor(mount: string): string
export function buildScanTargets(mounts: StorageMount[], dirsByRoot: Record<string, string[]>): ScanTarget[]
export function mountForPath(path: string, mounts: readonly string[]): string | null
```

**Spécification de comportement.**

`romsRootFor` donne le dossier des ROMs d'un support. Sur la carte SD c'est `<mount>/roms` ; sur un disque externe, Recalbox intercale son propre dossier : `<mount>/recalbox/roms`. Un support est « externe » quand son chemin contient `/externals/`.

`buildScanTargets` reçoit les supports et, pour chaque racine `/roms`, la liste de ses sous-dossiers. Elle produit une cible par dossier système. Elle **ne filtre pas** sur la présence d'un `gamelist.xml` : un dossier rempli mais jamais scrapé doit apparaître dans l'audit — c'est un cas intéressant que `listSystems()` masque aujourd'hui. Elle ignore les dossiers cachés (préfixe `.`) et le dossier `ports`, dont les gamelists sont imbriquées.

`mountForPath` rattache un chemin absolu à son support par **préfixe le plus long**. Sans cette règle, `/recalbox/share` étant préfixe de `/recalbox/share/externals/usb0`, tous les fichiers des disques externes seraient attribués à la carte SD. Un préfixe ne compte que s'il s'arrête sur une frontière de segment : `/recalbox/shareX` n'appartient pas à `/recalbox/share`.

- [ ] **Step 1: Écrire le test qui échoue**

`apps/dashboard/lib/rom-audit/__tests__/scan-targets.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import type { StorageMount } from '@/lib/recalbox/storage'
import { buildScanTargets, mountForPath, romsRootFor } from '../scan-targets'

function mount(path: string): StorageMount {
	return { label: path, mount: path, usedBytes: 0, sizeBytes: 1, percent: 0 }
}

// Les trois supports réels de la box de référence.
const SD = '/recalbox/share'
const USB0 = '/recalbox/share/externals/usb0'
const USB1 = '/recalbox/share/externals/usb1'

describe('romsRootFor', () => {
	it('puts the sd card roms directly under the mount', () => {
		expect(romsRootFor(SD)).toBe('/recalbox/share/roms')
	})

	it('inserts the recalbox directory on an external disk', () => {
		expect(romsRootFor(USB0)).toBe('/recalbox/share/externals/usb0/recalbox/roms')
	})
})

describe('buildScanTargets', () => {
	it('produces one target per system directory', () => {
		const targets = buildScanTargets([mount(SD)], {
			'/recalbox/share/roms': ['snes', 'megadrive'],
		})
		expect(targets).toEqual([
			{ mount: SD, system: 'snes', romsPath: '/recalbox/share/roms/snes' },
			{ mount: SD, system: 'megadrive', romsPath: '/recalbox/share/roms/megadrive' },
		])
	})

	it('covers every mount it is given', () => {
		const targets = buildScanTargets([mount(SD), mount(USB0)], {
			'/recalbox/share/roms': ['snes'],
			'/recalbox/share/externals/usb0/recalbox/roms': ['psx'],
		})
		expect(targets.map((t) => t.mount)).toEqual([SD, USB0])
		expect(targets.map((t) => t.system)).toEqual(['snes', 'psx'])
	})

	// Un dossier rempli mais jamais scrapé n'a pas de gamelist.xml. C'est
	// précisément un cas que l'audit doit révéler, pas masquer.
	it('does not require a gamelist to include a system', () => {
		const targets = buildScanTargets([mount(SD)], { '/recalbox/share/roms': ['jamaisscrape'] })
		expect(targets).toHaveLength(1)
	})

	it('skips hidden directories and ports', () => {
		const targets = buildScanTargets([mount(SD)], {
			'/recalbox/share/roms': ['.hidden', 'ports', 'snes'],
		})
		expect(targets.map((t) => t.system)).toEqual(['snes'])
	})

	it('yields nothing for a mount with no listing', () => {
		expect(buildScanTargets([mount(SD)], {})).toEqual([])
	})
})

describe('mountForPath', () => {
	const mounts = [SD, USB0, USB1]

	// Sans la règle du préfixe le plus long, toute la collection des disques
	// externes serait attribuée à la carte SD, qui en est le préfixe.
	it('picks the longest matching mount, not the first', () => {
		expect(mountForPath(`${USB0}/recalbox/roms/snes/game.zip`, mounts)).toBe(USB0)
		expect(mountForPath(`${USB1}/recalbox/roms/psx/game.chd`, mounts)).toBe(USB1)
	})

	it('still resolves a file that really is on the sd card', () => {
		expect(mountForPath('/recalbox/share/roms/snes/game.zip', mounts)).toBe(SD)
	})

	it('matches the mount itself', () => {
		expect(mountForPath(SD, mounts)).toBe(SD)
	})

	// Un préfixe qui ne s'arrête pas sur une frontière de segment n'en est pas un.
	it('does not match a sibling whose name merely starts the same', () => {
		expect(mountForPath('/recalbox/shareX/roms/snes/game.zip', mounts)).toBeNull()
	})

	it('returns null for a path under no mount', () => {
		expect(mountForPath('/tmp/game.zip', mounts)).toBeNull()
	})
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `rtk proxy pnpm exec vitest run lib/rom-audit/__tests__/scan-targets.test.ts`
Expected: FAIL — `Failed to resolve import "../scan-targets"`.

- [ ] **Step 3: Écrire `scan-targets.ts` pour satisfaire les tests**

Respecte les signatures du bloc **Interfaces** ci-dessus et la spécification de comportement. Module pur : aucun I/O, aucun import de `node:fs`.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `rtk proxy pnpm exec vitest run lib/rom-audit/__tests__/scan-targets.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Vérifier le module, le typage et le style**

Run: `rtk proxy pnpm exec vitest run lib/rom-audit/` puis `rtk proxy pnpm exec tsc --noEmit` puis `rtk proxy pnpm exec biome check lib/rom-audit/`
Expected: tests verts, **0** erreur tsc, Biome propre.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/rom-audit/scan-targets.ts apps/dashboard/lib/rom-audit/__tests__/scan-targets.test.ts
git commit -m "feat(rom-audit): cibles de scan et rattachement au support"
```

---

### Task 2: Le script Python de scan

**Files:**
- Create: `agent/scan_roms.py`
- Create: `agent/__tests__/test_scan_roms.py`

**Interfaces:**
- Consumes: rien. Le script est autonome, stdlib Python seule.
- Produces: un manifeste JSON sur la sortie standard, conforme au schéma de `lib/rom-audit/manifest.ts` (plan 1). La tâche 3 le consomme.

**Invocation.** `python3 scan_roms.py --target <mount>|<system>|<romsPath> [--target …]`, un argument par cible. Sortie : un objet JSON `{"entries": [...], "stats": {...}}` sur stdout, les diagnostics sur stderr.

**Champs d'une entrée** — noms exacts imposés par le schéma Zod du plan 1 :
`path`, `size`, `mtime`, `system`, `mount`, `kind`, et selon la stratégie `crc32`, `md5`, `sha1`, `rawSha1`, `serial`, `discNumber`, `discVersion`, `innerName`.

`kind` vaut exactement l'une de : `zip-entry`, `chd`, `rvz`, `sevenzip-entry`, `raw`.

**Contraintes de format issues du schéma** — les violer fait rejeter **tout** le manifeste :
- Les hashes sont hexadécimaux, longueur exacte : `crc32` 8, `md5` 32, `sha1` 40, `rawSha1` 40.
- `serial` fait exactement 4 caractères alphanumériques.
- `rawSha1` n'est autorisé que si `kind` vaut `chd` ; `serial`, `discNumber` et `discVersion` seulement si `kind` vaut `rvz`.
- `system`, `path` et `mount` ne doivent contenir ni octet nul, ni caractère de contrôle, ni segment `..`.

**Les cinq stratégies, par coût croissant.**

1. **`.zip` → `zip-entry`.** CRC32 lu dans le répertoire central via `zipfile.ZipFile.infolist()`, sans décompression. `innerName` = nom de l'entrée. Une archive à plusieurs entrées produit une entrée de manifeste par fichier contenu.

2. **`.chd` → `chd`.** 124 octets d'en-tête. Magic `MComprHD` sur les 8 premiers octets, version en big-endian sur 4 octets à l'offset 12. Offsets vérifiés dans les sources de [libchdr](https://github.com/rtissera/libchdr) :

   | Version | `sha1` | `rawsha1` |
   |---|---|---|
   | 5 | 84 | 64 |
   | 4 | 48 | 88 |
   | 3 | 80 | — |

   Chaque champ fait 20 octets. On émet `sha1`, et `rawSha1` quand la version l'expose.

3. **`.rvz`, `.wia`, `.iso` → `rvz`.** Le format [WIA/RVZ](https://github.com/dolphin-emu/dolphin/blob/master/docs/WiaAndRvz.md) place la structure `wia_disc_t` à l'offset `0x48`, contenant `dhead` : les 128 premiers octets du disque d'origine, en clair. Pour un `.iso` nu, `dhead` est simplement les 128 premiers octets du fichier.

   | Offset dans `dhead` | Contenu |
   |---|---|
   | `0x00`–`0x03` | game code, 4 caractères → `serial` |
   | `0x06` | numéro de disque → `discNumber` |
   | `0x07` | version → `discVersion` |

   Le game code doit valider `^[A-Za-z0-9]{4}$` ; sinon on n'émet ni `serial`, ni `discNumber`, ni `discVersion`, et le fichier reste un `rvz` sans identifiant.

4. **`.7z` → `sevenzip-entry`.** `7zr l -slt <archive>` liste un `CRC = XXXXXXXX` par entrée sans rien extraire. Le binaire est à `/usr/bin/7zr`. **S'il est absent, ces fichiers basculent sur la stratégie 5.**

   **Cas imbriqué, à ne pas rater.** Une minorité d'archives contiennent des `.zip` plutôt que des ROMs nues — le CRC listé est alors celui du zip intermédiaire, inutilisable contre le catalogue. Quand l'entrée porte l'extension `.zip`, on streame cette entrée via `7zr e -so <archive> <entrée>` et on lit le répertoire central du zip obtenu, en mémoire. Ignorer ce cas classerait un set entier en inconnu.

5. **Fichier nu → `raw`.** Lecture complète en flux, `zlib.crc32`, par blocs de 1 Mio. Seul cas réellement coûteux.

**Filtrage, avant toute lecture.** La majorité des fichiers ne sont pas des ROMs : 114 805 `.png`, 34 900 `.mp4` et 11 584 `.pdf` sur le seul usb0. On filtre par **liste d'extensions ignorées**, plus courte et plus sûre à maintenir qu'une liste d'extensions de ROMs, qui varie par système :

```text
png jpg jpeg gif bmp webp  mp4 mkv avi mp3 ogg wav
pdf txt nfo xml cfg ini dat db log bak backup keep m3u srm state
```

Les dossiers cachés et le dossier `media` sont ignorés. Un fichier de taille nulle est ignoré.

**Robustesse.** Le script ne doit **jamais** s'interrompre sur un fichier : archive corrompue, permission refusée, en-tête tronqué, lien symbolique cassé. Chaque échec incrémente un compteur et le fichier est omis. Les compteurs sont émis dans `stats` : `scanned`, `skipped`, `errors`, et le détail par stratégie.

- [ ] **Step 1: Écrire les tests qui échouent**

`agent/__tests__/test_scan_roms.py`, exécutable par `python3 -m unittest`. Il construit une arborescence temporaire et vérifie chaque stratégie.

```python
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, '..', 'scan_roms.py')


def run_scan(*targets):
    args = [sys.executable, SCRIPT]
    for t in targets:
        args += ['--target', t]
    out = subprocess.run(args, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise AssertionError(f'scan failed rc={out.returncode}: {out.stderr}')
    return json.loads(out.stdout)


def chd_header(version, sha1=b'\x11' * 20, rawsha1=b'\x22' * 20):
    """En-tête CHD de 124 octets, aux offsets réels de libchdr."""
    h = bytearray(124)
    h[0:8] = b'MComprHD'
    struct.pack_into('>I', h, 12, version)
    if version == 5:
        h[84:104] = sha1
        h[64:84] = rawsha1
    elif version == 4:
        h[48:68] = sha1
        h[88:108] = rawsha1
    elif version == 3:
        h[80:100] = sha1
    return bytes(h)


def rvz_bytes(game_code=b'GW7P', disc=0, ver=1):
    """RVZ minimal : wia_disc_t à 0x48, dont dhead porte l'en-tête disque."""
    buf = bytearray(0x48 + 0x80)
    buf[0:4] = b'RVZ\x01'
    dhead = bytearray(0x80)
    dhead[0:4] = game_code
    dhead[6] = disc
    dhead[7] = ver
    buf[0x48:0x48 + 0x80] = dhead
    return bytes(buf)


class ScanRomsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.roms = os.path.join(self.root, 'roms', 'snes')
        os.makedirs(self.roms)

    def tearDown(self):
        self.tmp.cleanup()

    def target(self):
        return f'{self.root}|snes|{self.roms}'

    def write(self, name, data):
        p = os.path.join(self.roms, name)
        with open(p, 'wb') as f:
            f.write(data)
        return p

    def entries(self):
        return run_scan(self.target())['entries']

    # --- stratégie 1 : zip ---

    def test_reads_zip_entry_crc_without_decompressing(self):
        payload = b'ROMDATA' * 100
        p = os.path.join(self.roms, 'Game.zip')
        with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('Game (Europe).sfc', payload)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'zip-entry')
        self.assertEqual(e['innerName'], 'Game (Europe).sfc')
        self.assertEqual(e['crc32'], '%08x' % zlib.crc32(payload))
        self.assertEqual(e['system'], 'snes')
        self.assertEqual(e['mount'], self.root)

    def test_emits_one_entry_per_file_in_a_multi_entry_zip(self):
        p = os.path.join(self.roms, 'Set.zip')
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('A.sfc', b'aaa')
            z.writestr('B.sfc', b'bbb')
        names = sorted(e['innerName'] for e in self.entries())
        self.assertEqual(names, ['A.sfc', 'B.sfc'])

    # --- stratégie 2 : chd ---

    def test_reads_chd_v5_header_hashes(self):
        self.write('Disc.chd', chd_header(5) + b'\x00' * 512)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'chd')
        self.assertEqual(e['sha1'], '11' * 20)
        self.assertEqual(e['rawSha1'], '22' * 20)

    def test_reads_chd_v4_header_hashes(self):
        self.write('Disc.chd', chd_header(4) + b'\x00' * 512)
        (e,) = self.entries()
        self.assertEqual(e['sha1'], '11' * 20)
        self.assertEqual(e['rawSha1'], '22' * 20)

    def test_chd_v3_has_no_rawsha1(self):
        self.write('Disc.chd', chd_header(3) + b'\x00' * 512)
        (e,) = self.entries()
        self.assertEqual(e['sha1'], '11' * 20)
        self.assertNotIn('rawSha1', e)

    def test_a_file_that_only_pretends_to_be_a_chd_is_not_one(self):
        self.write('Fake.chd', b'NOTACHD!' + b'\x00' * 200)
        (e,) = self.entries()
        self.assertNotIn('sha1', e)
        self.assertNotIn('rawSha1', e)

    # --- stratégie 3 : rvz / iso ---

    def test_reads_the_game_code_from_an_rvz_header(self):
        self.write('Game.rvz', rvz_bytes(b'GW7P', disc=0, ver=1))
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'rvz')
        self.assertEqual(e['serial'], 'GW7P')
        self.assertEqual(e['discNumber'], 0)
        self.assertEqual(e['discVersion'], 1)

    def test_reads_the_game_code_from_a_bare_iso(self):
        dhead = bytearray(0x80)
        dhead[0:4] = b'GALE'
        dhead[6] = 1
        self.write('Game.iso', bytes(dhead) + b'\x00' * 4096)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'rvz')
        self.assertEqual(e['serial'], 'GALE')
        self.assertEqual(e['discNumber'], 1)

    # Un code non alphanumérique ferait rejeter tout le manifeste par le schéma.
    def test_drops_an_unusable_game_code_rather_than_emitting_it(self):
        self.write('Bad.rvz', rvz_bytes(b'\x00\x01\x02\x03'))
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'rvz')
        self.assertNotIn('serial', e)
        self.assertNotIn('discNumber', e)

    # --- stratégie 5 : fichier nu ---

    def test_hashes_a_bare_rom_in_full(self):
        payload = b'\x01\x02\x03' * 5000
        self.write('Game.sfc', payload)
        (e,) = self.entries()
        self.assertEqual(e['kind'], 'raw')
        self.assertEqual(e['crc32'], '%08x' % zlib.crc32(payload))
        self.assertEqual(e['size'], len(payload))

    # --- filtrage ---

    def test_ignores_artwork_video_and_document_files(self):
        for name in ('cover.png', 'video.mp4', 'manual.pdf', 'notes.txt', 'list.m3u'):
            self.write(name, b'x' * 100)
        self.write('Game.sfc', b'rom')
        kinds = [os.path.basename(e['path']) for e in self.entries()]
        self.assertEqual(kinds, ['Game.sfc'])

    def test_ignores_hidden_directories_and_empty_files(self):
        os.makedirs(os.path.join(self.roms, '.hidden'))
        with open(os.path.join(self.roms, '.hidden', 'Game.sfc'), 'wb') as f:
            f.write(b'rom')
        self.write('Empty.sfc', b'')
        self.assertEqual(self.entries(), [])

    # --- robustesse ---

    def test_a_corrupt_archive_does_not_abort_the_scan(self):
        self.write('Broken.zip', b'this is not a zip at all')
        self.write('Good.sfc', b'rom')
        names = [os.path.basename(e['path']) for e in self.entries()]
        self.assertIn('Good.sfc', names)

    def test_reports_counters(self):
        self.write('Game.sfc', b'rom')
        self.write('Broken.zip', b'nope')
        stats = run_scan(self.target())['stats']
        self.assertGreaterEqual(stats['scanned'], 1)
        self.assertIn('errors', stats)

    def test_emits_nothing_for_a_missing_directory(self):
        result = run_scan(f'{self.root}|snes|{self.root}/does-not-exist')
        self.assertEqual(result['entries'], [])
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `python3 -m unittest discover -s agent/__tests__ -v`
Expected: FAIL — le script `agent/scan_roms.py` n'existe pas.

- [ ] **Step 3: Écrire `agent/scan_roms.py` pour satisfaire les tests**

Suis la spécification des cinq stratégies, du filtrage et de la robustesse ci-dessus. Stdlib seule. Aucune écriture sur le disque scanné.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `python3 -m unittest discover -s agent/__tests__ -v`
Expected: PASS — 16 tests.

- [ ] **Step 5: Vérifier le cas 7z si le binaire est disponible localement**

Run: `command -v 7z 7za 7zr`

S'il est présent, ajoute deux tests : une archive `.7z` contenant une ROM nue, dont le `crc32` émis doit égaler `zlib.crc32` du contenu ; et une archive `.7z` contenant un `.zip`, dont l'entrée émise doit porter le CRC de la ROM **à l'intérieur** du zip, pas celui du zip. S'il est absent, note-le dans le rapport et vérifie au moins que ces fichiers basculent proprement sur la stratégie 5 sans faire échouer le scan.

- [ ] **Step 6: Commit**

```bash
git add agent/scan_roms.py agent/__tests__/test_scan_roms.py
git commit -m "feat(rom-audit): script python de scan on-box"
```

---

### Task 3: Exécution SSH et assemblage du manifeste

**Files:**
- Create: `apps/dashboard/lib/rom-audit/scan-script.ts`
- Create: `apps/dashboard/lib/rom-audit/scan-runner.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/scan-runner.test.ts`

**Interfaces:**
- Consumes: `ScanTarget` (tâche 1) ; `parseManifest` et `ManifestEntry` de `./manifest` (plan 1) ; `shellQuote` de `@/lib/recalbox/shell` ; le type `SshClientLike` de `@/lib/recalbox/ssh-client`.
- Produces, consommés par la tâche 4 :

```ts
export function buildScanCommand(targets: readonly ScanTarget[]): string
export type ScanOutcome =
	| { status: 'ok'; entries: ManifestEntry[]; stats: Record<string, number> }
	| { status: 'failed'; reason: string }
export function runScan(ssh: SshClientLike, targets: readonly ScanTarget[]): Promise<ScanOutcome>
```

**Spécification de comportement.**

`buildScanCommand` compose la commande à exécuter sur la box. Le script Python est **poussé par l'entrée standard** plutôt qu'écrit sur le disque : le lot est en lecture seule, et rien ne doit subsister sur la Recalbox. La forme est `python3 - --target … --target …` avec le source du script fourni sur stdin, encodé en base64 pour traverser le shell sans dommage — le plan 1 a montré qu'un heredoc mal échappé fait recevoir les `\n` littéralement à Python.

**Tout argument venant d'une cible est passé par `shellQuote`.** Ces chemins proviennent d'un listage de la box ; ils peuvent contenir espaces, apostrophes et parenthèses.

`runScan` exécute la commande, parse la sortie JSON, valide les entrées avec `parseManifest` et renvoie un résultat discriminé. Elle **ne lève jamais** : une box injoignable, une sortie tronquée, un JSON invalide ou un manifeste rejeté par le schéma produisent `{ status: 'failed', reason }` avec une raison lisible. Un scan est une opération longue sur un matériel modeste ; échouer proprement est la seule option acceptable.

- [ ] **Step 1: Écrire le test qui échoue**

`apps/dashboard/lib/rom-audit/__tests__/scan-runner.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ScanTarget } from '../scan-targets'
import { buildScanCommand, runScan } from '../scan-runner'

const TARGETS: ScanTarget[] = [
	{ mount: '/recalbox/share', system: 'snes', romsPath: '/recalbox/share/roms/snes' },
]

const VALID_ENTRY = {
	path: '/recalbox/share/roms/snes/Game.zip',
	size: 1048576,
	mtime: 1721900000,
	system: 'snes',
	mount: '/recalbox/share',
	kind: 'zip-entry',
	crc32: 'E95A3DD7',
	innerName: 'Game (Europe).sfc',
}

function ssh(exec: (cmd: string) => Promise<string>) {
	return { exec: vi.fn(exec) }
}

describe('buildScanCommand', () => {
	it('feeds the script over stdin rather than writing it to the box', () => {
		const cmd = buildScanCommand(TARGETS)
		expect(cmd).toContain('base64 -d')
		expect(cmd).toContain('python3')
		// Rien ne doit subsister sur la Recalbox : ce lot est en lecture seule.
		expect(cmd).not.toMatch(/>\s*\/recalbox/)
	})

	it('passes each target as an argument', () => {
		const cmd = buildScanCommand(TARGETS)
		expect(cmd).toContain('--target')
		expect(cmd).toContain('/recalbox/share/roms/snes')
	})

	// Les chemins viennent d'un listage de la box et contiennent couramment des
	// espaces et des apostrophes.
	it('quotes a target path containing a space and a quote', () => {
		const cmd = buildScanCommand([
			{ mount: '/mnt', system: 'snes', romsPath: "/mnt/mes jeux/l'aventure" },
		])
		expect(cmd).not.toMatch(/--target\s+\/mnt\/mes jeux/)
		expect(cmd).toContain("'\\''")
	})
})

describe('runScan', () => {
	it('returns the validated entries on a well-formed run', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [VALID_ENTRY], stats: { scanned: 1 } }))
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('ok')
		if (res.status !== 'ok') throw new Error('expected ok')
		expect(res.entries).toHaveLength(1)
		expect(res.stats.scanned).toBe(1)
	})

	// Le schéma normalise ; le runner ne doit pas court-circuiter cette étape.
	it('normalises through the manifest schema', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [VALID_ENTRY], stats: {} }))
		const res = await runScan(client, TARGETS)
		if (res.status !== 'ok') throw new Error('expected ok')
		expect(res.entries[0]?.crc32).toBe('e95a3dd7')
	})

	it('fails cleanly when the box is unreachable', async () => {
		const client = ssh(async () => {
			throw new Error('ECONNREFUSED')
		})
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('failed')
		if (res.status !== 'failed') throw new Error('expected failed')
		expect(res.reason).toContain('ECONNREFUSED')
	})

	it('fails cleanly on output that is not json', async () => {
		const client = ssh(async () => 'python3: command not found')
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('failed')
	})

	it('fails cleanly on truncated json', async () => {
		const client = ssh(async () => '{"entries": [')
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('failed')
	})

	// Une entrée invalide fait rejeter tout le manifeste : c'est le contrat de
	// parseManifest, et il doit remonter comme un échec, pas comme un succès vide.
	it('fails cleanly when the schema rejects an entry', async () => {
		const client = ssh(async () =>
			JSON.stringify({ entries: [{ ...VALID_ENTRY, kind: 'floppy' }], stats: {} }),
		)
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('failed')
	})

	it('accepts an empty scan', async () => {
		const client = ssh(async () => JSON.stringify({ entries: [], stats: { scanned: 0 } }))
		const res = await runScan(client, TARGETS)
		expect(res.status).toBe('ok')
	})

	it('never throws', async () => {
		for (const output of ['', 'null', '[]', '{"entries": null}']) {
			const client = ssh(async () => output)
			await expect(runScan(client, TARGETS)).resolves.toBeDefined()
		}
	})
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `rtk proxy pnpm exec vitest run lib/rom-audit/__tests__/scan-runner.test.ts`
Expected: FAIL — `Failed to resolve import "../scan-runner"`.

- [ ] **Step 3: Écrire `scan-script.ts` et `scan-runner.ts`**

`scan-script.ts` expose le source Python comme une constante. Le fichier `agent/scan_roms.py` doit rester **la seule copie** du script : c'est lui que la tâche 2 teste, et une seconde copie divergerait sans que rien ne le signale.

**Attention au mode de chargement.** Une lecture par `readFileSync` d'un chemin relatif fonctionne sous `tsx` (tâche 4) et sous Vitest, mais casse dès que le module est repris par le bundler Next.js au plan 2B : le `.py` n'est pas un asset connu et le chemin relatif ne survit pas au build. Deux sorties acceptables : soit une étape de génération qui produit un `.ts` à partir du `.py` et que la CI vérifie à jour, soit un `import ... with { type: 'text' }` si la chaîne d'outillage le supporte.

Choisis, justifie ton choix dans le rapport, et **vérifie que le module se charge aussi bien sous Vitest que sous `tsx`** — c'est le minimum que ce lot exige, et ce qui déterminera le coût au plan 2B.

`scan-runner.ts` respecte les signatures du bloc **Interfaces** et la spécification de comportement.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `rtk proxy pnpm exec vitest run lib/rom-audit/__tests__/scan-runner.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Vérifier le module, le typage et le style**

Run: `rtk proxy pnpm exec vitest run lib/rom-audit/` puis `rtk proxy pnpm exec tsc --noEmit` puis `rtk proxy pnpm exec biome check lib/rom-audit/`
Expected: tests verts, **0** erreur tsc, Biome propre.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/rom-audit/scan-script.ts apps/dashboard/lib/rom-audit/scan-runner.ts apps/dashboard/lib/rom-audit/__tests__/scan-runner.test.ts
git commit -m "feat(rom-audit): execution ssh du scan et assemblage du manifeste"
```

---

### Task 4: Scanner une vraie Recalbox depuis le CLI

**Files:**
- Modify: `apps/dashboard/scripts/rom-audit.ts`

**Interfaces:**
- Consumes: `buildScanTargets`, `romsRootFor`, `mountForPath` (tâche 1) ; `runScan` (tâche 3) ; `fetchStorageInfo` de `@/lib/recalbox/storage` ; `getSshClient` de `@/lib/recalbox/ssh-client` ; `loadDatForSystem`, `auditSystem`, `filterMissingGames` (plan 1).
- Produces: la commande `pnpm exec tsx scripts/rom-audit.ts --scan --recalbox=<id> --system=<id>`.

**Spécification de comportement.** Le script gagne un mode scan. Avec `--scan`, au lieu de lire un manifeste depuis un fichier, il découvre les supports via `fetchStorageInfo`, liste les dossiers de chaque racine `/roms` par SSH, construit les cibles, lance le scan, puis enchaîne sur l'audit existant. `--manifest` reste accepté et exclusif de `--scan`. Une option `--json <chemin>` écrit le manifeste obtenu sur disque, pour pouvoir le rejouer sans rescanner.

Le mode scan affiche une ligne de progression par système sur **stderr**, pour que stdout reste une sortie exploitable en redirection.

Les échecs restent lisibles, comme le reste du script : une box injoignable, un scan en échec ou un système absent des cibles produisent un message clair et un code de sortie non nul, jamais une trace brute.

- [ ] **Step 1: Étendre le script**

Applique la spécification ci-dessus en conservant le comportement actuel du mode `--manifest`, y compris ses messages d'erreur.

- [ ] **Step 2: Vérifier que le mode manifeste n'a pas régressé**

Run: `rtk proxy pnpm exec tsx scripts/rom-audit.ts --system=snes --manifest=/tmp/manifest.json`
Expected: la sortie habituelle — catalogue SNES, `Entrées DAT : 4256`, `Jeux au catalogue: 2602`.

- [ ] **Step 3: Scanner un petit système réel**

Choisis un système peu volumineux sur la vraie box pour une première boucle rapide.

Run: `rtk proxy pnpm exec tsx scripts/rom-audit.ts --scan --recalbox=<id> --system=gamegear --json=/tmp/scan-gamegear.json`

Expected: un manifeste non vide, un taux de `verified` élevé pour un système à cartouche, et une liste de manquants dont les titres sont canoniques — sans suffixe de région ni de révision.

**Rapporte les chiffres obtenus.** C'est la première fois que la chaîne complète tourne sur des données réelles. Si le taux de `verified` est bas sur un système à cartouche, c'est probablement un défaut de la stratégie zip ou du matching, pas la collection.

- [ ] **Step 4: Scanner un système CD, puis un système à archives 7z**

Run: `rtk proxy pnpm exec tsx scripts/rom-audit.ts --scan --recalbox=<id> --system=psx --json=/tmp/scan-psx.json`

Expected: des entrées `chd` identifiées au niveau `named`, conformément à la spécification — le hash d'un CHD ne correspond à aucune entrée Redump, c'est mesuré et documenté.

Run: `rtk proxy pnpm exec tsx scripts/rom-audit.ts --scan --recalbox=<id> --system=nes --json=/tmp/scan-nes.json`

Expected: des entrées `sevenzip-entry`. Rapporte le temps écoulé : le relevé de référence donne ~45 ms par archive.

- [ ] **Step 5: Vérifier l'ensemble**

Run: `rtk proxy pnpm exec vitest run` puis `rtk proxy pnpm exec tsc --noEmit` puis `rtk proxy pnpm exec biome check lib/rom-audit/ scripts/rom-audit.ts`
Expected: suite complète verte, **0** erreur tsc, Biome propre.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/scripts/rom-audit.ts
git commit -m "feat(rom-audit): mode scan d'une vraie recalbox dans le cli"
```

---

## Ce que ce plan ne fait pas

Le plan 2B prendra, sur ce socle :

- les tables `rom_files` et `rom_scans`, leur migration Drizzle, et l'incrémentalité **en écriture** — un rescan sans changement doit produire zéro écriture, pas 75 000 upserts identiques ;
- la répartition décidée : **détail par fichier en local**, et en serverless uniquement les agrégats par système plus les fichiers `unknown`, les seuls actionnables — la liste des manquants étant déjà recalculée à la volée depuis le catalogue ;
- le transport agent : commande `scan` ajoutée à l'allowlist d'`agent_commands`, boucle dans `agent/agent.py`, route `/api/agent/rom-scan` chunkée ;
- les routes `/api/rom-audit/scan` et `/api/rom-audit/export` ;
- la page `/[locale]/collection/audit` ;
- le deep verify à la demande, exécuté sur l'hôte dashboard et non sur la box.

## Points reportés du plan 1, à traiter dans le 2B

- `parseManifest` est tout-ou-rien : une entrée invalide rejette le tableau entier. Acceptable en interne ; à trancher entrée par entrée avant la route HTTP d'ingestion.
- Le **parsing en streaming** des catalogues est exigé par la spécification et n'a pas été fait. Sans effet aujourd'hui, fatal le jour où un catalogue MAME est branché.
- `DatGame.region`, `discVersion` et `broadcastStandards` sont produits, typés et testés, mais consommés nulle part. À brancher ou à retirer.
