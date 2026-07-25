# Audit de collection ROMs — Plan 1 : noyau

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le noyau pur de l'audit — parsing des DAT, canonicalisation des titres, matching et regroupement par jeu — livré avec un script CLI qui audite un manifeste contre un vrai DAT.

**Architecture:** Cinq modules sans I/O sous `apps/dashboard/lib/rom-audit/`, plus un module de catalogue qui isole le réseau et le cache. Aucune dépendance à la base, à SSH ou à l'UI : tout est testable avec Vitest sans Recalbox.

**Tech Stack:** TypeScript, Vitest 2, Zod 4, tsx pour le script CLI.

Spec de référence : [`docs/superpowers/specs/2026-07-25-rom-audit-design.md`](../specs/2026-07-25-rom-audit-design.md)

## Global Constraints

- Branche de travail : `feat/rom-audit` (déjà créée, contient le spec).
- Style Biome imposé par le repo : **tabulations**, guillemets **simples**, **pas de point-virgule**, virgules finales.
- Tests dans `__tests__/` à côté du code testé ; fixtures dans `__tests__/__fixtures__/`.
- L'alias `@` pointe sur `apps/dashboard/` (`vitest.config.ts`).
- Toutes les commandes se lancent depuis `apps/dashboard/`.
- Lancer un fichier de test : `pnpm exec vitest run lib/rom-audit/__tests__/<fichier>`.
- Aucun module de ce plan ne fait d'I/O sauf `catalog.ts`.
- Les hashes sont normalisés en **minuscules** partout, dès le parsing.

---

### Task 1: Parser de DAT clrmamepro

**Files:**
- Create: `apps/dashboard/lib/rom-audit/dat-parser.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/dat-parser.test.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/__fixtures__/no-intro-snes.dat`
- Create: `apps/dashboard/lib/rom-audit/__tests__/__fixtures__/redump-gamecube.dat`

**Interfaces:**
- Consumes: rien.
- Produces: `parseDat(text: string): Dat`, et les types `Dat`, `DatGame`, `DatRom` réutilisés par les tâches 4, 6 et 7.

**Format d'entrée.** Les DAT de `libretro-database` suivent une structure ligne à ligne stable : un bloc s'ouvre sur une ligne se terminant par `(`, et se ferme sur une ligne dont le contenu trimmé vaut exactement `)`. Les entrées `rom ( … )` tiennent sur une seule ligne. Le parser s'appuie sur cette structure plutôt que sur un comptage de parenthèses, qui casserait sur les titres contenant `(Europe)`.

- [ ] **Step 1: Créer les fixtures**

`apps/dashboard/lib/rom-audit/__tests__/__fixtures__/no-intro-snes.dat` :

```text
clrmamepro (
	name "Nintendo - Super Nintendo Entertainment System"
	description "Nintendo - Super Nintendo Entertainment System"
	version "2026.05.02"
)

game (
	name "Dragon Ball Z - La Legende Saien (France)"
	region "France"
	rom ( name "Dragon Ball Z - La Legende Saien (France).sfc" size 2097152 crc 8F24F886 md5 36E1391F0B1F29F16EF5D4EB83C3725B sha1 827C071F8AEBE93F80576800266F74F82FF9E41B )
)
game (
	name "Super Mario World (USA)"
	region "USA"
	rom ( name "Super Mario World (USA).sfc" size 524288 crc B19ED489 md5 A31BEAD4B8B29F26B13F2F3B0B2B9C6D sha1 6B47BB75D16514B6A476AA0C73A683A2A4C18765 )
)
game (
	name "Super Mario World (Europe) (Rev 1)"
	region "Europe"
	rom ( name "Super Mario World (Europe) (Rev 1).sfc" size 524288 crc CE7BEF3F md5 D2C4E1A5F8B39C6D7E0A1B2C3D4E5F60 sha1 1F2E3D4C5B6A79889A0B1C2D3E4F5061728394A5 )
)
game (
	name "Star Fox 2 (Japan) (Proto)"
	region "Japan"
	rom ( name "Star Fox 2 (Japan) (Proto).sfc" size 1048576 crc 4A3B2C1D md5 B7C8D9E0F1A2B3C4D5E6F708192A3B4C sha1 9E8D7C6B5A4938271605F4E3D2C1B0A998877665 )
)
```

La quatrième entrée porte le tag `(Proto)` : sans elle, le test de filtrage par
catégorie de la tâche 4 n'assertirait rien.

`apps/dashboard/lib/rom-audit/__tests__/__fixtures__/redump-gamecube.dat` :

```text
clrmamepro (
	name "Nintendo - GameCube"
	description "Nintendo - GameCube"
	version "2026.05.02"
)

game (
	name "007 - Agent Under Fire (Europe)"
	region "Europe"
	serial "DL-DOL-GW7P-EUR"
	rom ( name "007 - Agent Under Fire (Europe).iso" size 1459978240 crc E3B90F14 md5 54D17B5C7A4EEE4BFBD648251BFAB15E sha1 1B0EC6BBB9B098906ACC9D86A41E036816B90D74 serial "DL-DOL-GW7P-EUR" )
)
game (
	name "007 - Agent Under Fire (USA)"
	region "USA"
	serial "DL-DOL-GW7E-USA"
	rom ( name "007 - Agent Under Fire (USA).iso" size 1459978240 crc 04486E6C md5 987AF8DCA9DD263C27305B4F139A3547 sha1 E518156CE617A7153D5F4320DECD57070FD35620 serial "DL-DOL-GW7E-USA" )
)
```

- [ ] **Step 2: Écrire le test qui échoue**

`apps/dashboard/lib/rom-audit/__tests__/dat-parser.test.ts` :

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDat } from '../dat-parser'

const FIXTURES = join(__dirname, '__fixtures__')

function fixture(name: string) {
	return readFileSync(join(FIXTURES, name), 'utf-8')
}

describe('parseDat', () => {
	it('reads the header name and version', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		expect(dat.name).toBe('Nintendo - Super Nintendo Entertainment System')
		expect(dat.version).toBe('2026.05.02')
	})

	it('parses every game block', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		expect(dat.games).toHaveLength(4)
		expect(dat.games[0].name).toBe('Dragon Ball Z - La Legende Saien (France)')
		expect(dat.games[0].region).toBe('France')
	})

	it('parses rom size and lowercases every hash', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		const rom = dat.games[0].roms[0]
		expect(rom.name).toBe('Dragon Ball Z - La Legende Saien (France).sfc')
		expect(rom.size).toBe(2097152)
		expect(rom.crc).toBe('8f24f886')
		expect(rom.md5).toBe('36e1391f0b1f29f16ef5d4eb83c3725b')
		expect(rom.sha1).toBe('827c071f8aebe93f80576800266f74f82ff9e41b')
	})

	it('keeps parentheses that belong to the game name', () => {
		const dat = parseDat(fixture('no-intro-snes.dat'))
		expect(dat.games[2].name).toBe('Super Mario World (Europe) (Rev 1)')
		expect(dat.games[2].roms[0].name).toBe('Super Mario World (Europe) (Rev 1).sfc')
	})

	it('parses the serial field on both game and rom', () => {
		const dat = parseDat(fixture('redump-gamecube.dat'))
		expect(dat.games[0].serial).toBe('DL-DOL-GW7P-EUR')
		expect(dat.games[0].roms[0].serial).toBe('DL-DOL-GW7P-EUR')
	})

	it('returns an empty game list for an empty input', () => {
		expect(parseDat('').games).toEqual([])
	})
})
```

- [ ] **Step 3: Vérifier que le test échoue**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/dat-parser.test.ts`
Expected: FAIL — `Failed to resolve import "../dat-parser"`.

- [ ] **Step 4: Implémenter le parser**

`apps/dashboard/lib/rom-audit/dat-parser.ts` :

```ts
export type DatRom = {
	name: string
	size: number
	crc?: string
	md5?: string
	sha1?: string
	serial?: string
}

export type DatGame = {
	name: string
	region?: string
	serial?: string
	roms: DatRom[]
}

export type Dat = {
	name: string
	version: string
	games: DatGame[]
}

const QUOTED = (field: string) => new RegExp(`\\b${field}\\s+"([^"]*)"`)
const ROM_LINE = /^rom\s*\((.*)\)$/

function quoted(line: string, field: string): string | undefined {
	return QUOTED(field).exec(line)?.[1]
}

function parseRom(body: string): DatRom | null {
	const name = quoted(body, 'name')
	if (!name) return null
	const size = /\bsize\s+(\d+)/.exec(body)?.[1]
	const hash = (field: string) =>
		new RegExp(`\\b${field}\\s+([0-9A-Fa-f]+)`).exec(body)?.[1]?.toLowerCase()
	return {
		name,
		size: size ? Number(size) : 0,
		crc: hash('crc'),
		md5: hash('md5'),
		sha1: hash('sha1'),
		serial: quoted(body, 'serial'),
	}
}

/**
 * Parses the clrmamepro DAT format used by libretro-database.
 *
 * Blocks open on a line ending with `(` and close on a line whose trimmed
 * content is exactly `)`. We rely on that rather than counting parentheses,
 * because game names legitimately contain them — "Super Mario World (Europe)".
 */
export function parseDat(text: string): Dat {
	const dat: Dat = { name: '', version: '', games: [] }
	let block: 'header' | 'game' | null = null
	let current: DatGame | null = null

	for (const raw of text.split('\n')) {
		const line = raw.trim()
		if (!line) continue

		if (line === ')') {
			if (block === 'game' && current) dat.games.push(current)
			block = null
			current = null
			continue
		}

		if (line.startsWith('clrmamepro') && line.endsWith('(')) {
			block = 'header'
			continue
		}

		if (line.startsWith('game') && line.endsWith('(')) {
			block = 'game'
			current = { name: '', roms: [] }
			continue
		}

		if (block === 'header') {
			dat.name = quoted(line, 'name') ?? dat.name
			dat.version = quoted(line, 'version') ?? dat.version
			continue
		}

		if (block === 'game' && current) {
			// Toute ligne commençant par `rom` est une entrée ROM, matchée ou non.
			// Sans ce garde, une ligne rom tronquée retomberait dans le parsing des
			// champs du jeu et son `name` écraserait silencieusement celui du jeu.
			if (line.startsWith('rom')) {
				const romBody = ROM_LINE.exec(line)?.[1]
				if (romBody) {
					const rom = parseRom(romBody)
					if (rom) current.roms.push(rom)
				}
				continue
			}
			current.name = quoted(line, 'name') ?? current.name
			current.region = quoted(line, 'region') ?? current.region
			current.serial = quoted(line, 'serial') ?? current.serial
		}
	}

	return dat
}
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/dat-parser.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Vérifier sur un vrai DAT**

Run:

```bash
curl -s "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/no-intro/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System.dat" -o /tmp/snes.dat
pnpm exec tsx -e "import{readFileSync}from'node:fs';import{parseDat}from'./lib/rom-audit/dat-parser';const d=parseDat(readFileSync('/tmp/snes.dat','utf-8'));console.log(d.name,d.version,d.games.length,d.games.filter(g=>g.roms.length===0).length)"
```

Expected: le nom du système, la version `2026.05.02`, un nombre de jeux supérieur à 3000, et **0** jeu sans ROM.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/lib/rom-audit/
git commit -m "feat(rom-audit): parser de DAT clrmamepro"
```

---

### Task 2: Canonicalisation des titres

**Files:**
- Create: `apps/dashboard/lib/rom-audit/canonical.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/canonical.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `canonicalTitle(name: string): string` et `parseNameTags(name: string): NameTags`, consommés par la tâche 4.

C'est le module qui porte le plus de risque fonctionnel. La règle du spec est **conservatrice** : on ne retire un groupe final que si son contenu appartient au vocabulaire connu. Un groupe non reconnu reste dans le titre — mieux vaut scinder un jeu en deux, ce qui se voit, que fusionner deux jeux distincts, ce qui ferait disparaître un manquant.

- [ ] **Step 1: Écrire le test qui échoue**

`apps/dashboard/lib/rom-audit/__tests__/canonical.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { canonicalTitle, parseNameTags } from '../canonical'

describe('canonicalTitle', () => {
	it('strips a lone region tag', () => {
		expect(canonicalTitle('Super Mario World (USA)')).toBe('Super Mario World')
	})

	it('strips stacked region and revision tags', () => {
		expect(canonicalTitle('Super Mario World (Europe) (Rev 1)')).toBe('Super Mario World')
	})

	it('groups every disc of a multi-disc game under one title', () => {
		expect(canonicalTitle('Final Fantasy VII (USA) (Disc 1)')).toBe('Final Fantasy VII')
		expect(canonicalTitle('Final Fantasy VII (USA) (Disc 3)')).toBe('Final Fantasy VII')
	})

	it('strips language lists', () => {
		expect(canonicalTitle('Terranigma (Europe) (En,Fr,De,Es)')).toBe('Terranigma')
	})

	it('strips bracket dump markers', () => {
		expect(canonicalTitle('Chrono Trigger (USA) [b]')).toBe('Chrono Trigger')
	})

	it('strips category tags', () => {
		expect(canonicalTitle('Star Fox 2 (World) (Proto)')).toBe('Star Fox 2')
		expect(canonicalTitle('Rockman & Forte (Japan) (Unl)')).toBe('Rockman & Forte')
	})

	it('keeps a trailing group that is not a known tag', () => {
		expect(canonicalTitle('Wario Land II (USA) (Golden Edition)')).toBe(
			'Wario Land II (Golden Edition)',
		)
	})

	it('keeps an ampersand title untouched when it carries no tag', () => {
		expect(canonicalTitle('Sonic & Knuckles')).toBe('Sonic & Knuckles')
	})

	it('never returns an empty title', () => {
		expect(canonicalTitle('(USA)')).toBe('(USA)')
	})
})

describe('parseNameTags', () => {
	it('extracts regions', () => {
		expect(parseNameTags('Sonic (USA, Europe)').regions).toEqual(['USA', 'Europe'])
	})

	it('extracts the revision', () => {
		expect(parseNameTags('Sonic (USA) (Rev 2)').revision).toBe('Rev 2')
	})

	it('extracts the disc number', () => {
		expect(parseNameTags('FF VII (USA) (Disc 2)').disc).toBe(2)
	})

	it('extracts categories', () => {
		expect(parseNameTags('Star Fox 2 (World) (Proto)').categories).toEqual(['proto'])
		expect(parseNameTags('Game (USA) [b]').categories).toEqual(['baddump'])
	})

	it('returns empty collections when there is no tag', () => {
		const tags = parseNameTags('Sonic & Knuckles')
		expect(tags.regions).toEqual([])
		expect(tags.categories).toEqual([])
		expect(tags.revision).toBeUndefined()
	})
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/canonical.test.ts`
Expected: FAIL — `Failed to resolve import "../canonical"`.

- [ ] **Step 3: Implémenter la canonicalisation**

`apps/dashboard/lib/rom-audit/canonical.ts` :

```ts
export type NameTags = {
	regions: string[]
	languages: string[]
	categories: string[]
	revision?: string
	disc?: number
}

const REGIONS = new Set([
	'Asia', 'Australia', 'Brazil', 'Canada', 'China', 'Denmark', 'Europe', 'Finland',
	'France', 'Germany', 'Hong Kong', 'Italy', 'Japan', 'Korea', 'Netherlands',
	'Norway', 'Poland', 'Russia', 'Spain', 'Sweden', 'Taiwan', 'UK', 'USA',
	'Unknown', 'World',
])

// (Proto), (Beta 2), (Demo)… → the canonical category slug.
const CATEGORY_WORDS: Record<string, string> = {
	proto: 'proto',
	prototype: 'proto',
	beta: 'beta',
	demo: 'demo',
	sample: 'sample',
	alt: 'alt',
	unl: 'unl',
	unlicensed: 'unl',
	pirate: 'pirate',
	aftermarket: 'aftermarket',
	homebrew: 'homebrew',
	'virtual console': 'virtual-console',
	'switch online': 'switch-online',
}

const BRACKET_CATEGORY: Record<string, string> = {
	b: 'baddump',
	'!': 'verified',
	a: 'alt',
}

const LANG_LIST = /^[A-Z][a-z](?:,[A-Z][a-z])*$/
const REV = /^Rev\s+\S+$/i
const DISC = /^(?:Disc|Disk|Side|Tape)\s+(\S+)$/i
const VERSION = /^v[\d.]+$/i

/** Splits a trailing "(…)" or "[…]" group off the end of a name. */
function splitTrailingGroup(name: string): { head: string; group: string; bracket: boolean } | null {
	const trimmed = name.trimEnd()
	const close = trimmed.at(-1)
	if (close !== ')' && close !== ']') return null
	const open = close === ')' ? '(' : '['
	let depth = 0
	for (let i = trimmed.length - 1; i >= 0; i--) {
		const ch = trimmed[i]
		if (ch === close) depth++
		else if (ch === open) {
			depth--
			if (depth === 0) {
				return {
					head: trimmed.slice(0, i).trimEnd(),
					group: trimmed.slice(i + 1, -1),
					bracket: close === ']',
				}
			}
		}
	}
	return null
}

/** True when the group content is a tag we recognise, and may therefore be stripped. */
function isKnownTag(group: string, bracket: boolean): boolean {
	if (bracket) return group.toLowerCase() in BRACKET_CATEGORY
	const g = group.trim()
	if (!g) return false
	if (REV.test(g) || DISC.test(g) || VERSION.test(g) || LANG_LIST.test(g)) return true
	if (g.split(',').every((part) => REGIONS.has(part.trim()))) return true
	const base = g.replace(/\s+\d+$/, '').toLowerCase()
	return base in CATEGORY_WORDS
}

/**
 * The DAT game name minus its trailing metadata tags. Groups that are not part
 * of the known vocabulary stay in the title: splitting one game in two is
 * visible and fixable, merging two distinct games would hide a missing entry.
 */
export function canonicalTitle(name: string): string {
	let current = name.trim()
	for (;;) {
		const split = splitTrailingGroup(current)
		if (!split || !isKnownTag(split.group, split.bracket)) break
		if (!split.head) break
		current = split.head
	}
	return current
}

export function parseNameTags(name: string): NameTags {
	const tags: NameTags = { regions: [], languages: [], categories: [] }
	let current = name.trim()
	for (;;) {
		const split = splitTrailingGroup(current)
		if (!split || !isKnownTag(split.group, split.bracket) || !split.head) break
		const g = split.group.trim()

		if (split.bracket) {
			tags.categories.unshift(BRACKET_CATEGORY[g.toLowerCase()])
		} else if (REV.test(g)) {
			tags.revision = g
		} else if (DISC.test(g)) {
			const n = Number(DISC.exec(g)?.[1])
			if (Number.isFinite(n)) tags.disc = n
		} else if (LANG_LIST.test(g)) {
			tags.languages = g.split(',')
		} else if (g.split(',').every((part) => REGIONS.has(part.trim()))) {
			tags.regions = g.split(',').map((part) => part.trim())
		} else {
			const base = g.replace(/\s+\d+$/, '').toLowerCase()
			const slug = CATEGORY_WORDS[base]
			if (slug) tags.categories.unshift(slug)
		}

		current = split.head
	}
	return tags
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/canonical.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Mesurer le regroupement sur un vrai DAT**

Run:

```bash
pnpm exec tsx -e "import{readFileSync}from'node:fs';import{parseDat}from'./lib/rom-audit/dat-parser';import{canonicalTitle}from'./lib/rom-audit/canonical';const d=parseDat(readFileSync('/tmp/snes.dat','utf-8'));const t=new Set(d.games.map(g=>canonicalTitle(g.name)));console.log('entrées',d.games.length,'titres',t.size)"
```

Expected: un nombre de titres nettement inférieur au nombre d'entrées (ordre de grandeur : ~4000 entrées pour ~2500 titres). Inspecter à l'œil quelques titres contenant encore des parenthèses pour vérifier qu'aucun tag courant n'a été oublié — chaque oubli constaté devient un cas de test ajouté à l'étape 1.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/rom-audit/canonical.ts apps/dashboard/lib/rom-audit/__tests__/canonical.test.ts
git commit -m "feat(rom-audit): canonicalisation des titres DAT"
```

---

### Task 3: Types et validation du manifeste

**Files:**
- Create: `apps/dashboard/lib/rom-audit/manifest.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/manifest.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: le type `ManifestEntry`, le schéma `manifestEntrySchema`, et `parseManifest(input: unknown): ManifestEntry[]`, consommés par les tâches 4 et 7 puis par le plan 2 (route d'ingestion de l'agent).

Le manifeste est produit sur la box et traverse une frontière de confiance (SSH ou HTTP agent). Il est donc validé avec Zod avant tout usage.

- [ ] **Step 1: Écrire le test qui échoue**

`apps/dashboard/lib/rom-audit/__tests__/manifest.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { parseManifest } from '../manifest'

const valid = {
	path: '/recalbox/share/roms/snes/Zelda.zip',
	size: 1048576,
	mtime: 1721900000,
	system: 'snes',
	mount: '/recalbox/share',
	kind: 'zip-entry',
	crc32: 'e95a3dd7',
	innerName: 'Zelda (Europe).sfc',
}

describe('parseManifest', () => {
	it('accepts a well-formed entry', () => {
		const [entry] = parseManifest([valid])
		expect(entry.path).toBe(valid.path)
		expect(entry.crc32).toBe('e95a3dd7')
	})

	it('lowercases hashes coming from the box', () => {
		const [entry] = parseManifest([{ ...valid, crc32: 'E95A3DD7' }])
		expect(entry.crc32).toBe('e95a3dd7')
	})

	it('accepts an entry with no hash at all', () => {
		const [entry] = parseManifest([{ ...valid, kind: 'raw', crc32: undefined }])
		expect(entry.crc32).toBeUndefined()
	})

	it('accepts a chd entry carrying sha1 and rawSha1', () => {
		const [entry] = parseManifest([
			{ ...valid, kind: 'chd', crc32: undefined, sha1: 'AA'.repeat(20), rawSha1: 'BB'.repeat(20) },
		])
		expect(entry.sha1).toBe('aa'.repeat(20))
		expect(entry.rawSha1).toBe('bb'.repeat(20))
	})

	it('accepts an rvz entry carrying a serial', () => {
		const [entry] = parseManifest([
			{ ...valid, kind: 'rvz', crc32: undefined, serial: 'GW7P', discNumber: 0, discVersion: 0 },
		])
		expect(entry.serial).toBe('GW7P')
	})

	it('rejects an entry without a path', () => {
		expect(() => parseManifest([{ ...valid, path: undefined }])).toThrow()
	})

	it('rejects an unknown kind', () => {
		expect(() => parseManifest([{ ...valid, kind: 'floppy' }])).toThrow()
	})

	it('rejects a non-array input', () => {
		expect(() => parseManifest({ path: 'x' })).toThrow()
	})
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/manifest.test.ts`
Expected: FAIL — `Failed to resolve import "../manifest"`.

- [ ] **Step 3: Implémenter le schéma**

`apps/dashboard/lib/rom-audit/manifest.ts` :

```ts
import { z } from 'zod'

/** How the on-box scanner identified the file — mirrors the five strategies in the spec. */
export const ROM_KINDS = ['zip-entry', 'chd', 'rvz', 'sevenzip-entry', 'raw'] as const

const lowerHex = z
	.string()
	.regex(/^[0-9a-fA-F]+$/)
	.transform((s) => s.toLowerCase())

export const manifestEntrySchema = z.object({
	path: z.string().min(1),
	size: z.number().int().nonnegative(),
	mtime: z.number().int().nonnegative(),
	system: z.string().min(1),
	mount: z.string().min(1),
	kind: z.enum(ROM_KINDS),
	crc32: lowerHex.optional(),
	md5: lowerHex.optional(),
	sha1: lowerHex.optional(),
	/** CHD only: SHA1 of the decompressed data stream, deterministic across chdman versions. */
	rawSha1: lowerHex.optional(),
	/** RVZ/ISO only: the 4-character game code read from the disc header. */
	serial: z.string().optional(),
	discNumber: z.number().int().nonnegative().optional(),
	discVersion: z.number().int().nonnegative().optional(),
	/** Name of the entry inside the archive, when the file is a container. */
	innerName: z.string().optional(),
})

export type ManifestEntry = z.infer<typeof manifestEntrySchema>

export function parseManifest(input: unknown): ManifestEntry[] {
	return z.array(manifestEntrySchema).parse(input)
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/manifest.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/lib/rom-audit/manifest.ts apps/dashboard/lib/rom-audit/__tests__/manifest.test.ts
git commit -m "feat(rom-audit): schéma de validation du manifeste de scan"
```

---

### Task 4: Matching et regroupement par jeu

**Files:**
- Create: `apps/dashboard/lib/rom-audit/match.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/match.test.ts`

**Interfaces:**
- Consumes: `Dat`, `DatGame`, `DatRom` (tâche 1) ; `canonicalTitle`, `parseNameTags` (tâche 2) ; `ManifestEntry` (tâche 3).
- Produces: `auditSystem(system, manifest, dat): AuditResult` et `filterMissingGames(games, filters): CanonicalGame[]`, consommés par la tâche 7 puis par le plan 2 (routes API et UI).

Fonction pure, aucun I/O. C'est le cœur du lot.

- [ ] **Step 1: Écrire le test qui échoue**

`apps/dashboard/lib/rom-audit/__tests__/match.test.ts` :

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDat } from '../dat-parser'
import type { ManifestEntry } from '../manifest'
import { auditSystem, filterMissingGames } from '../match'

const FIXTURES = join(__dirname, '__fixtures__')
const snes = parseDat(readFileSync(join(FIXTURES, 'no-intro-snes.dat'), 'utf-8'))
const gamecube = parseDat(readFileSync(join(FIXTURES, 'redump-gamecube.dat'), 'utf-8'))

function entry(over: Partial<ManifestEntry>): ManifestEntry {
	return {
		path: '/recalbox/share/roms/snes/game.zip',
		size: 524288,
		mtime: 1,
		system: 'snes',
		mount: '/recalbox/share',
		kind: 'zip-entry',
		...over,
	}
}

describe('auditSystem', () => {
	it('matches by crc32 and reports verified', () => {
		const res = auditSystem('snes', [entry({ crc32: '8f24f886' })], snes)
		expect(res.files[0].matchLevel).toBe('verified')
		expect(res.files[0].datEntryName).toBe('Dragon Ball Z - La Legende Saien (France)')
	})

	it('matches by sha1 when crc32 is absent', () => {
		const res = auditSystem(
			'snes',
			[entry({ kind: 'raw', sha1: '827c071f8aebe93f80576800266f74f82ff9e41b' })],
			snes,
		)
		expect(res.files[0].matchLevel).toBe('verified')
	})

	it('matches an rvz by serial code', () => {
		const res = auditSystem(
			'gamecube',
			[entry({ system: 'gamecube', kind: 'rvz', serial: 'GW7P' })],
			gamecube,
		)
		expect(res.files[0].matchLevel).toBe('serial')
		expect(res.files[0].datEntryName).toBe('007 - Agent Under Fire (Europe)')
	})

	it('falls back to the file name when no hash matches', () => {
		const res = auditSystem(
			'snes',
			[entry({ kind: 'chd', path: '/roms/snes/Super Mario World (USA).chd' })],
			snes,
		)
		expect(res.files[0].matchLevel).toBe('named')
		expect(res.files[0].datEntryName).toBe('Super Mario World (USA)')
	})

	it('reports unknown for a file nothing recognises', () => {
		const res = auditSystem('snes', [entry({ crc32: 'deadbeef', path: '/roms/snes/hack.zip' })], snes)
		expect(res.files[0].matchLevel).toBe('unknown')
		expect(res.files[0].datEntryName).toBeUndefined()
	})

	it('counts rom entries raw, not games', () => {
		const res = auditSystem('snes', [entry({ crc32: '8f24f886' })], snes)
		expect(res.totalRomEntries).toBe(4)
		expect(res.matchedRomEntries).toBe(1)
	})

	it('groups every variant of a title under one canonical game', () => {
		const res = auditSystem('snes', [], snes)
		const mario = res.games.find((g) => g.title === 'Super Mario World')
		expect(mario?.entries).toHaveLength(2)
	})

	it('marks a game owned when any one of its roms matches', () => {
		const res = auditSystem('snes', [entry({ crc32: 'b19ed489' })], snes)
		const mario = res.games.find((g) => g.title === 'Super Mario World')
		expect(mario?.owned).toBe(true)
		expect(res.missingGames.map((g) => g.title)).not.toContain('Super Mario World')
	})

	it('lists a game as missing when none of its roms matches', () => {
		const res = auditSystem('snes', [], snes)
		expect(res.missingGames.map((g) => g.title)).toContain('Super Mario World')
		expect(res.missingGames.map((g) => g.title)).toContain('Dragon Ball Z - La Legende Saien')
	})

	it('never matches the same dat entry twice', () => {
		const res = auditSystem(
			'snes',
			[entry({ crc32: '8f24f886' }), entry({ crc32: '8f24f886', path: '/roms/snes/dup.zip' })],
			snes,
		)
		expect(res.matchedRomEntries).toBe(1)
		expect(res.files.filter((f) => f.matchLevel === 'verified')).toHaveLength(2)
	})
})

describe('filterMissingGames', () => {
	it('keeps only games available in the requested region', () => {
		const res = auditSystem('snes', [], snes)
		const usa = filterMissingGames(res.missingGames, { regions: ['USA'] })
		expect(usa.map((g) => g.title)).toEqual(['Super Mario World'])
	})

	it('excludes categories on request', () => {
		const res = auditSystem('snes', [], snes)
		expect(res.missingGames.map((g) => g.title)).toContain('Star Fox 2')
		const kept = filterMissingGames(res.missingGames, { excludeCategories: ['proto'] })
		expect(kept.map((g) => g.title)).not.toContain('Star Fox 2')
		expect(kept).toHaveLength(res.missingGames.length - 1)
	})
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/match.test.ts`
Expected: FAIL — `Failed to resolve import "../match"`.

- [ ] **Step 3: Implémenter le matching**

`apps/dashboard/lib/rom-audit/match.ts` :

```ts
import { canonicalTitle, parseNameTags } from './canonical'
import type { Dat, DatGame, DatRom } from './dat-parser'
import type { ManifestEntry } from './manifest'

export type MatchLevel = 'verified' | 'serial' | 'named' | 'unknown'

export type MatchedFile = ManifestEntry & {
	matchLevel: MatchLevel
	datEntryName?: string
	canonicalTitle?: string
}

export type DatEntry = { game: DatGame; rom: DatRom }

export type CanonicalGame = {
	title: string
	regions: string[]
	categories: string[]
	entries: DatEntry[]
	owned: boolean
	ownedDiscs: number[]
	missingDiscs: number[]
}

export type AuditResult = {
	system: string
	datName: string
	datVersion: string
	totalRomEntries: number
	matchedRomEntries: number
	files: MatchedFile[]
	games: CanonicalGame[]
	missingGames: CanonicalGame[]
}

export type MissingFilters = {
	regions?: string[]
	excludeCategories?: string[]
}

/** "DL-DOL-GW7P-EUR" → "GW7P". The only 4-char alphanumeric segment. */
export function serialCode(serial: string): string | undefined {
	return serial.split('-').find((part) => /^[A-Z0-9]{4}$/.test(part))
}

/** Comparable form of a file or dat name: no extension, no case, single spaces. */
export function normalizeName(name: string): string {
	return name
		.replace(/\.[a-z0-9]{1,5}$/i, '')
		.replace(/_/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase()
}

function fileBaseName(path: string): string {
	return path.split('/').pop() ?? path
}

type Index = {
	byCrc: Map<string, DatEntry>
	bySha1: Map<string, DatEntry>
	byMd5: Map<string, DatEntry>
	bySerial: Map<string, DatEntry[]>
	byName: Map<string, DatEntry>
}

function buildIndex(dat: Dat): Index {
	const index: Index = {
		byCrc: new Map(),
		bySha1: new Map(),
		byMd5: new Map(),
		bySerial: new Map(),
		byName: new Map(),
	}
	for (const game of dat.games) {
		for (const rom of game.roms) {
			const entry: DatEntry = { game, rom }
			if (rom.crc && !index.byCrc.has(rom.crc)) index.byCrc.set(rom.crc, entry)
			if (rom.sha1 && !index.bySha1.has(rom.sha1)) index.bySha1.set(rom.sha1, entry)
			if (rom.md5 && !index.byMd5.has(rom.md5)) index.byMd5.set(rom.md5, entry)

			const serial = rom.serial ?? game.serial
			const code = serial ? serialCode(serial) : undefined
			if (code) {
				const bucket = index.bySerial.get(code)
				if (bucket) bucket.push(entry)
				else index.bySerial.set(code, [entry])
			}

			for (const candidate of [rom.name, game.name]) {
				const key = normalizeName(candidate)
				if (!index.byName.has(key)) index.byName.set(key, entry)
			}
		}
	}
	return index
}

function matchOne(file: ManifestEntry, index: Index): { entry?: DatEntry; level: MatchLevel } {
	if (file.crc32) {
		const hit = index.byCrc.get(file.crc32)
		if (hit) return { entry: hit, level: 'verified' }
	}
	for (const [hash, map] of [
		[file.sha1, index.bySha1],
		[file.rawSha1, index.bySha1],
		[file.md5, index.byMd5],
	] as const) {
		if (!hash) continue
		const hit = map.get(hash)
		if (hit) return { entry: hit, level: 'verified' }
	}

	if (file.serial) {
		const bucket = index.bySerial.get(file.serial) ?? []
		if (bucket.length === 1) return { entry: bucket[0], level: 'serial' }
		if (bucket.length > 1) {
			// Several revisions share a game code — disambiguate on the file name.
			const wanted = normalizeName(file.innerName ?? fileBaseName(file.path))
			const exact = bucket.find((e) => normalizeName(e.game.name) === wanted)
			if (exact) return { entry: exact, level: 'serial' }
		}
	}

	const nameKey = normalizeName(file.innerName ?? fileBaseName(file.path))
	const byName = index.byName.get(nameKey)
	if (byName) return { entry: byName, level: 'named' }

	return { level: 'unknown' }
}

/**
 * Crosses a scan manifest with a reference DAT. Pure: no network, no database,
 * no filesystem. Counting is raw — one dat rom entry is one unit — while the
 * missing list is grouped by canonical game, which is the actionable view.
 */
export function auditSystem(system: string, manifest: ManifestEntry[], dat: Dat): AuditResult {
	const index = buildIndex(dat)
	const matchedRoms = new Set<DatRom>()
	const files: MatchedFile[] = []

	for (const file of manifest) {
		const { entry, level } = matchOne(file, index)
		if (entry) matchedRoms.add(entry.rom)
		files.push({
			...file,
			matchLevel: level,
			datEntryName: entry?.game.name,
			canonicalTitle: entry ? canonicalTitle(entry.game.name) : undefined,
		})
	}

	const grouped = new Map<string, CanonicalGame>()
	let totalRomEntries = 0

	for (const game of dat.games) {
		const title = canonicalTitle(game.name)
		const tags = parseNameTags(game.name)
		let group = grouped.get(title)
		if (!group) {
			group = {
				title,
				regions: [],
				categories: [],
				entries: [],
				owned: false,
				ownedDiscs: [],
				missingDiscs: [],
			}
			grouped.set(title, group)
		}
		for (const region of tags.regions) {
			if (!group.regions.includes(region)) group.regions.push(region)
		}
		for (const category of tags.categories) {
			if (!group.categories.includes(category)) group.categories.push(category)
		}
		for (const rom of game.roms) {
			totalRomEntries++
			group.entries.push({ game, rom })
			const owned = matchedRoms.has(rom)
			if (owned) group.owned = true
			if (tags.disc !== undefined) {
				const bucket = owned ? group.ownedDiscs : group.missingDiscs
				if (!bucket.includes(tags.disc)) bucket.push(tags.disc)
			}
		}
	}

	const games = [...grouped.values()]
	for (const game of games) {
		game.missingDiscs = game.missingDiscs.filter((d) => !game.ownedDiscs.includes(d))
	}

	return {
		system,
		datName: dat.name,
		datVersion: dat.version,
		totalRomEntries,
		matchedRomEntries: matchedRoms.size,
		files,
		games,
		missingGames: games.filter((g) => !g.owned),
	}
}

export function filterMissingGames(games: CanonicalGame[], filters: MissingFilters): CanonicalGame[] {
	return games.filter((game) => {
		if (filters.regions?.length) {
			if (!game.regions.some((r) => filters.regions?.includes(r))) return false
		}
		if (filters.excludeCategories?.length) {
			if (game.categories.some((c) => filters.excludeCategories?.includes(c))) return false
		}
		return true
	})
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/match.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Lancer toute la suite du module**

Run: `pnpm exec vitest run lib/rom-audit/`
Expected: PASS — 40 tests sur 4 fichiers.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/lib/rom-audit/match.ts apps/dashboard/lib/rom-audit/__tests__/match.test.ts
git commit -m "feat(rom-audit): matching des roms et regroupement par jeu canonique"
```

---

### Task 5: Mapping système → catalogue

**Files:**
- Modify: `apps/dashboard/lib/recalbox/system-meta.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/system-catalog.test.ts`

**Interfaces:**
- Consumes: `SYSTEM_META` existant.
- Produces: les champs `datSource`, `datFile`, `ssConsoleId` sur `SystemMeta`, et `catalogForSystem(id: string): SystemCatalog | null`, consommés par les tâches 6 et 7.

`SYSTEM_META` contient déjà 76 entrées `{ name, emoji }`. On ajoute trois champs **optionnels** : leur absence signifie « inventaire seul, sans catalogue », état valide et attendu pour une partie des systèmes.

- [ ] **Step 1: Écrire le test qui échoue**

`apps/dashboard/lib/rom-audit/__tests__/system-catalog.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { SYSTEM_META } from '@/lib/recalbox/system-meta'
import { catalogForSystem } from '../system-catalog'

describe('catalogForSystem', () => {
	it('maps snes to its no-intro dat', () => {
		expect(catalogForSystem('snes')).toEqual({
			source: 'no-intro',
			file: 'Nintendo - Super Nintendo Entertainment System.dat',
			ssConsoleId: 4,
		})
	})

	it('maps gamecube to its redump dat', () => {
		expect(catalogForSystem('gamecube')?.source).toBe('redump')
		expect(catalogForSystem('gamecube')?.file).toBe('Nintendo - GameCube.dat')
	})

	it('maps wii to its redump dat', () => {
		expect(catalogForSystem('wii')?.source).toBe('redump')
	})

	it('returns null for a system with no catalogue', () => {
		expect(catalogForSystem('amiga600')).toBeNull()
	})

	it('returns null for an unknown system', () => {
		expect(catalogForSystem('nope')).toBeNull()
	})

	it('never declares a dat file without a source', () => {
		for (const [id, meta] of Object.entries(SYSTEM_META)) {
			if (meta.datFile) expect(meta.datSource, id).toBeDefined()
			if (meta.datSource) expect(meta.datFile, id).toBeDefined()
		}
	})
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/system-catalog.test.ts`
Expected: FAIL — `Failed to resolve import "../system-catalog"`.

- [ ] **Step 3: Étendre le type et renseigner les systèmes à cartouche**

Dans `apps/dashboard/lib/recalbox/system-meta.ts`, remplacer la définition du type :

```ts
export type SystemMeta = {
	name: string
	emoji: string
	/** Reference catalogue in libretro-database. Absent = inventory only, no completion figure. */
	datSource?: 'no-intro' | 'redump' | 'mame'
	datFile?: string
	ssConsoleId?: number
}
```

Puis renseigner les entrées. Exemples exacts à appliquer (les noms de fichiers doivent correspondre au caractère près à ceux de `libretro-database`) :

```ts
	snes: {
		name: 'Super Nintendo',
		emoji: '🎮',
		datSource: 'no-intro',
		datFile: 'Nintendo - Super Nintendo Entertainment System.dat',
		ssConsoleId: 4,
	},
	gamecube: {
		name: 'GameCube',
		emoji: '🟣',
		datSource: 'redump',
		datFile: 'Nintendo - GameCube.dat',
		ssConsoleId: 13,
	},
	wii: {
		name: 'Wii',
		emoji: '🎯',
		datSource: 'redump',
		datFile: 'Nintendo - Wii.dat',
		ssConsoleId: 16,
	},
```

Conserver le `name` et l'`emoji` actuels de chaque entrée : on ajoute des champs, on n'en réécrit aucun.

- [ ] **Step 4: Lister les noms de fichiers disponibles pour renseigner le reste**

Run:

```bash
curl -s "https://api.github.com/repos/libretro/libretro-database/contents/metadat/no-intro" | grep '"name"'
curl -s "https://api.github.com/repos/libretro/libretro-database/contents/metadat/redump" | grep '"name"'
```

Renseigner `datSource` et `datFile` pour chaque système de `SYSTEM_META` qui a un fichier correspondant. Laisser les trois champs absents partout où il n'y en a pas — micros, systèmes exotiques. Ne pas inventer de nom de fichier : seul un nom présent dans les listes ci-dessus est valide.

`ssConsoleId` est facultatif à cette tâche et peut rester absent ; il ne sert qu'au lien vers super-retrogamers, jamais au matching.

- [ ] **Step 5: Écrire l'accesseur**

`apps/dashboard/lib/rom-audit/system-catalog.ts` :

```ts
import { SYSTEM_META } from '@/lib/recalbox/system-meta'

export type SystemCatalog = {
	source: 'no-intro' | 'redump' | 'mame'
	file: string
	ssConsoleId?: number
}

/** The reference catalogue for a Recalbox system id, or null when it has none. */
export function catalogForSystem(id: string): SystemCatalog | null {
	const meta = SYSTEM_META[id]
	if (!meta?.datSource || !meta.datFile) return null
	return { source: meta.datSource, file: meta.datFile, ssConsoleId: meta.ssConsoleId }
}
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/system-catalog.test.ts`
Expected: PASS — 6 tests.

Si le test `snes` échoue sur `ssConsoleId`, l'identifiant réel se lit dans la base super-retrogamers, colonne `ssConsoleId` de la table des consoles, ou se vérifie sur `https://www.screenscraper.fr/medias/<id>/gameslist.csv` — un identifiant correct renvoie un CSV, un mauvais renvoie 404. Corriger la valeur dans `SYSTEM_META` d'après cette vérification. Ne jamais inventer un identifiant, et ne jamais supprimer ni affaiblir l'assertion pour faire passer le test.

- [ ] **Step 7: Vérifier que rien d'autre n'a cassé**

Run: `pnpm exec vitest run` puis `pnpm lint`
Expected: PASS sur les deux. `SYSTEM_META` est consommé par `systems.ts` et par des composants client — l'ajout de champs optionnels ne doit rien casser.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/lib/recalbox/system-meta.ts apps/dashboard/lib/rom-audit/system-catalog.ts apps/dashboard/lib/rom-audit/__tests__/system-catalog.test.ts
git commit -m "feat(rom-audit): mapping des systèmes vers leur catalogue de référence"
```

---

### Task 6: Récupération et cache des DAT

**Files:**
- Create: `apps/dashboard/lib/rom-audit/catalog.ts`
- Create: `apps/dashboard/lib/rom-audit/__tests__/catalog.test.ts`

**Interfaces:**
- Consumes: `catalogForSystem` (tâche 5), `parseDat` (tâche 1).
- Produces: `loadDatForSystem(system: string, deps?: CatalogDeps): Promise<Dat | null>`, consommé par la tâche 7 puis par le plan 2.

Seul module du plan qui fait de l'I/O. Le réseau et le stockage sont injectés pour rester testables sans accès extérieur.

- [ ] **Step 1: Écrire le test qui échoue**

`apps/dashboard/lib/rom-audit/__tests__/catalog.test.ts` :

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CachedDat, CatalogDeps } from '../catalog'
import { loadDatForSystem } from '../catalog'

const DAT_TEXT = readFileSync(join(__dirname, '__fixtures__', 'no-intro-snes.dat'), 'utf-8')

function deps(over: Partial<CatalogDeps> = {}) {
	const store = new Map<string, CachedDat>()
	return {
		now: () => 0,
		read: vi.fn(async (key: string) => store.get(key) ?? null),
		write: vi.fn(async (key: string, value: CachedDat) => {
			store.set(key, value)
		}),
		fetchDat: vi.fn(async () => ({ status: 200, text: DAT_TEXT, etag: 'W/"abc"' })),
		...over,
	}
}

describe('loadDatForSystem', () => {
	it('fetches and parses on a cold cache', async () => {
		const d = deps()
		const dat = await loadDatForSystem('snes', d)
		expect(dat?.games).toHaveLength(3)
		expect(d.fetchDat).toHaveBeenCalledOnce()
		expect(d.write).toHaveBeenCalledOnce()
	})

	it('serves from cache without any network call when fresh', async () => {
		const d = deps()
		await loadDatForSystem('snes', d)
		d.fetchDat.mockClear()
		const dat = await loadDatForSystem('snes', d)
		expect(dat?.games).toHaveLength(3)
		expect(d.fetchDat).not.toHaveBeenCalled()
	})

	it('revalidates with the stored etag once the cache is stale', async () => {
		const d = deps({ now: () => 0 })
		await loadDatForSystem('snes', d)
		const stale = { ...d, now: () => 8 * 24 * 60 * 60 * 1000 }
		stale.fetchDat = vi.fn(async () => ({ status: 304, text: '', etag: 'W/"abc"' }))
		const dat = await loadDatForSystem('snes', stale)
		expect(stale.fetchDat).toHaveBeenCalledWith(expect.any(String), 'W/"abc"')
		expect(dat?.games).toHaveLength(3)
	})

	it('returns null for a system without a catalogue', async () => {
		expect(await loadDatForSystem('amiga600', deps())).toBeNull()
	})

	it('falls back to the stale cache when the network fails', async () => {
		const d = deps()
		await loadDatForSystem('snes', d)
		const broken = { ...d, now: () => 8 * 24 * 60 * 60 * 1000 }
		broken.fetchDat = vi.fn(async () => {
			throw new Error('offline')
		})
		const dat = await loadDatForSystem('snes', broken)
		expect(dat?.games).toHaveLength(3)
	})

	it('returns null when the network fails and nothing is cached', async () => {
		const d = deps()
		d.fetchDat = vi.fn(async () => {
			throw new Error('offline')
		})
		expect(await loadDatForSystem('snes', d)).toBeNull()
	})
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/catalog.test.ts`
Expected: FAIL — `Failed to resolve import "../catalog"`.

- [ ] **Step 3: Implémenter le catalogue**

`apps/dashboard/lib/rom-audit/catalog.ts` :

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from '@/lib/logger'
import { type Dat, parseDat } from './dat-parser'
import { catalogForSystem } from './system-catalog'

const BASE_URL = 'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export type CachedDat = { text: string; etag?: string; fetchedAt: number }

export type CatalogDeps = {
	now: () => number
	read: (key: string) => Promise<CachedDat | null>
	write: (key: string, value: CachedDat) => Promise<void>
	fetchDat: (url: string, etag?: string) => Promise<{ status: number; text: string; etag?: string }>
}

function cacheDir(): string {
	return path.resolve(process.env.ROM_AUDIT_CACHE_DIR ?? path.join(process.cwd(), '.dat-cache'))
}

const fileDeps: CatalogDeps = {
	now: () => Date.now(),
	read: async (key) => {
		try {
			return JSON.parse(await readFile(path.join(cacheDir(), `${key}.json`), 'utf-8')) as CachedDat
		} catch {
			return null
		}
	},
	write: async (key, value) => {
		const dest = path.join(cacheDir(), `${key}.json`)
		await mkdir(path.dirname(dest), { recursive: true })
		await writeFile(dest, JSON.stringify(value))
	},
	fetchDat: async (url, etag) => {
		const res = await fetch(url, { headers: etag ? { 'If-None-Match': etag } : {} })
		return {
			status: res.status,
			text: res.status === 200 ? await res.text() : '',
			etag: res.headers.get('etag') ?? undefined,
		}
	},
}

/** Cache key for a system's dat — safe for both a filename and an object-storage key. */
function cacheKey(source: string, file: string): string {
	return `${source}__${file.replace(/[^a-zA-Z0-9.-]/g, '_')}`
}

/**
 * The reference DAT for a system, from cache when fresh, revalidated with the
 * stored ETag when stale. Returns null when the system has no catalogue, or
 * when the network fails with nothing cached to fall back on.
 */
export async function loadDatForSystem(
	system: string,
	deps: CatalogDeps = fileDeps,
): Promise<Dat | null> {
	const catalog = catalogForSystem(system)
	if (!catalog) return null

	const key = cacheKey(catalog.source, catalog.file)
	const url = `${BASE_URL}/${catalog.source}/${encodeURIComponent(catalog.file)}`
	const cached = await deps.read(key)

	if (cached && deps.now() - cached.fetchedAt < TTL_MS) return parseDat(cached.text)

	try {
		const res = await deps.fetchDat(url, cached?.etag)
		if (res.status === 304 && cached) {
			await deps.write(key, { ...cached, fetchedAt: deps.now() })
			return parseDat(cached.text)
		}
		if (res.status === 200) {
			await deps.write(key, { text: res.text, etag: res.etag, fetchedAt: deps.now() })
			return parseDat(res.text)
		}
		logger.warn(`rom-audit: unexpected status ${res.status} for ${catalog.file}`)
	} catch (err) {
		logger.warn(`rom-audit: dat fetch failed for ${catalog.file}: ${String(err)}`)
	}

	// Stale is better than nothing — the catalogue moves slowly.
	return cached ? parseDat(cached.text) : null
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm exec vitest run lib/rom-audit/__tests__/catalog.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Vérifier contre le vrai réseau**

Run:

```bash
pnpm exec tsx -e "import{loadDatForSystem}from'./lib/rom-audit/catalog';loadDatForSystem('snes').then(d=>console.log(d?.name,d?.version,d?.games.length))"
```

Expected: le nom du système, `2026.05.02`, plus de 3000 jeux. Relancer la même commande : elle doit répondre instantanément et sans requête réseau.

- [ ] **Step 6: Ignorer le cache dans git**

Ajouter à `apps/dashboard/.gitignore` :

```text
.dat-cache/
```

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/lib/rom-audit/catalog.ts apps/dashboard/lib/rom-audit/__tests__/catalog.test.ts apps/dashboard/.gitignore
git commit -m "feat(rom-audit): récupération et cache des dat de référence"
```

---

### Task 7: Script CLI d'audit bout en bout

**Files:**
- Create: `apps/dashboard/scripts/rom-audit.ts`
- Modify: `apps/dashboard/package.json`

**Interfaces:**
- Consumes: `parseManifest` (tâche 3), `auditSystem` et `filterMissingGames` (tâche 4), `loadDatForSystem` (tâche 6).
- Produces: la commande `pnpm --filter @recalbox/dashboard exec tsx scripts/rom-audit.ts`, qui prouve que le noyau fonctionne sur des données réelles avant qu'une seule ligne du plan 2 soit écrite.

Le script prend un manifeste JSON produit à la main (le scan on-box arrive au plan 2) et affiche le résultat d'audit.

- [ ] **Step 1: Écrire le script**

`apps/dashboard/scripts/rom-audit.ts` :

```ts
#!/usr/bin/env tsx

/**
 * Audite un manifeste de scan contre le catalogue de référence d'un système.
 *
 * Le manifeste est un tableau JSON d'entrées conformes à lib/rom-audit/manifest.ts.
 * Le scan on-box qui le produit arrive au plan 2 ; en attendant, on le fabrique
 * à la main pour valider le noyau sur des données réelles.
 *
 * Usage:
 *   tsx scripts/rom-audit.ts --system=snes --manifest=./manifest.json
 *   tsx scripts/rom-audit.ts --system=snes --manifest=./manifest.json --missing --region=Europe
 */

import { readFileSync } from 'node:fs'
import { loadDatForSystem } from '@/lib/rom-audit/catalog'
import { parseManifest } from '@/lib/rom-audit/manifest'
import { auditSystem, filterMissingGames } from '@/lib/rom-audit/match'

function arg(name: string): string | undefined {
	return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

async function main() {
	const system = arg('system')
	const manifestPath = arg('manifest')
	if (!system || !manifestPath) {
		console.error('Usage: tsx scripts/rom-audit.ts --system=<id> --manifest=<path.json>')
		process.exit(1)
	}

	const dat = await loadDatForSystem(system)
	if (!dat) {
		console.error(`Aucun catalogue de référence pour le système "${system}".`)
		process.exit(1)
	}

	const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
	const result = auditSystem(system, manifest, dat)

	const pct = result.totalRomEntries
		? ((result.matchedRomEntries / result.totalRomEntries) * 100).toFixed(2)
		: '0.00'

	console.log(`${result.datName} — dat ${result.datVersion}`)
	console.log(`ROMs scannées   : ${result.files.length}`)
	console.log(`Entrées DAT     : ${result.totalRomEntries}`)
	console.log(`Entrées matchées: ${result.matchedRomEntries} (${pct} %)`)

	const byLevel = new Map<string, number>()
	for (const f of result.files) byLevel.set(f.matchLevel, (byLevel.get(f.matchLevel) ?? 0) + 1)
	for (const [level, count] of byLevel) console.log(`  ${level.padEnd(9)} ${count}`)

	console.log(`Jeux au catalogue: ${result.games.length}`)
	console.log(`Jeux manquants   : ${result.missingGames.length}`)

	if (process.argv.includes('--missing')) {
		const region = arg('region')
		const missing = filterMissingGames(result.missingGames, {
			regions: region ? [region] : undefined,
		})
		console.log(`\n--- ${missing.length} jeux manquants ---`)
		for (const game of missing) console.log(game.title)
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
```

- [ ] **Step 2: Déclarer la commande**

Dans `apps/dashboard/package.json`, ajouter à `scripts` :

```json
		"rom-audit": "tsx scripts/rom-audit.ts",
```

- [ ] **Step 3: Fabriquer un manifeste de test réaliste**

Créer `/tmp/manifest.json`. Les trois CRC ci-dessous sont ceux des fixtures de la tâche 1 ; le troisième fichier est volontairement inconnu du DAT.

```json
[
  {
    "path": "/recalbox/share/roms/snes/Dragon Ball Z - La Legende Saien (France).zip",
    "size": 2097152, "mtime": 1721900000, "system": "snes", "mount": "/recalbox/share",
    "kind": "zip-entry", "crc32": "8f24f886",
    "innerName": "Dragon Ball Z - La Legende Saien (France).sfc"
  },
  {
    "path": "/recalbox/share/roms/snes/Super Mario World (USA).zip",
    "size": 524288, "mtime": 1721900001, "system": "snes", "mount": "/recalbox/share",
    "kind": "zip-entry", "crc32": "b19ed489",
    "innerName": "Super Mario World (USA).sfc"
  },
  {
    "path": "/recalbox/share/roms/snes/Mon Hack Perso.zip",
    "size": 1048576, "mtime": 1721900002, "system": "snes", "mount": "/recalbox/share",
    "kind": "zip-entry", "crc32": "deadbeef",
    "innerName": "Mon Hack Perso.sfc"
  }
]
```

- [ ] **Step 4: Lancer l'audit contre le vrai DAT SNES**

Run:

```bash
pnpm exec tsx scripts/rom-audit.ts --system=snes --manifest=/tmp/manifest.json
```

Expected:
- `Nintendo - Super Nintendo Entertainment System — dat 2026.05.02`
- `ROMs scannées : 3`
- `Entrées DAT` supérieur à 3000
- `verified 2` et `unknown 1` dans la répartition
- `Jeux manquants` très proche de `Jeux au catalogue`, à deux unités près

Si `Super Mario World (USA)` ressort en `unknown`, c'est que le CRC `b19ed489` de la fixture ne correspond pas au vrai DAT : la fixture est synthétique pour ce titre. Vérifier avec `grep -A2 'Super Mario World (USA)' /tmp/snes.dat` et corriger le manifeste avec le CRC réel — **pas** la fixture, qui doit rester stable pour les tests unitaires.

- [ ] **Step 5: Vérifier la liste des manquants filtrée**

Run:

```bash
pnpm exec tsx scripts/rom-audit.ts --system=snes --manifest=/tmp/manifest.json --missing --region=Europe | head -30
```

Expected: une liste de titres canoniques **sans** suffixe de région ni de révision — c'est la preuve visuelle que la canonicalisation de la tâche 2 fonctionne sur données réelles.

- [ ] **Step 6: Vérifier l'ensemble**

Run: `pnpm exec vitest run lib/rom-audit/` puis `pnpm lint`
Expected: PASS sur les deux.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/scripts/rom-audit.ts apps/dashboard/package.json
git commit -m "feat(rom-audit): script cli d'audit bout en bout"
```

---

## Ce que ce plan ne fait pas

Le plan 2 couvrira, sur le même socle :

- le script Python de scan on-box (cinq stratégies d'identification) ;
- la découverte des supports via `storage.ts`, carte SD comprise ;
- les tables `rom_files` et `rom_scans` et leur migration Drizzle ;
- les deux transports — tâche de fond SSH et commande `scan` pour l'agent, avec la route `/api/agent/rom-scan` chunkée ;
- les routes `/api/rom-audit/scan` et `/api/rom-audit/export` ;
- la page `/[locale]/collection/audit` ;
- le deep verify à la demande sur un titre CHD ou RVZ.
