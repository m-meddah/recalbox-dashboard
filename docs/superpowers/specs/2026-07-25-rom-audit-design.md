# Audit de collection ROMs — design

**Date** : 2026-07-25
**Statut** : validé, prêt pour plan d'implémentation

## Objectif

Donner à l'utilisateur une vue exacte de sa collection de ROMs : ce qu'il possède
sur chaque support physique, ce que le catalogue de référence contient, et l'écart
entre les deux — par système.

Le lot est **strictement en lecture**. Rien n'est téléchargé, rien n'est écrit sur
la Recalbox.

### Hors périmètre (explicitement)

- Tout téléchargement de ROM, depuis quelque source que ce soit.
- Toute écriture sur la box : suppression de doublons, renommage, déplacement,
  régénération de gamelist.
- Tout appel à l'API ScreenScraper `jeuInfos` (donc aucun quota consommé).
- La vérification profonde des CHD en masse. Elle existe uniquement à la demande,
  sur un titre choisi par l'utilisateur.

L'import depuis des sources fournies par l'utilisateur et la réparation de
collection sont des lots ultérieurs qui se grefferont sur ce socle.

## Décisions actées

| Sujet | Décision |
|---|---|
| Périmètre | Audit seul, lecture seule |
| Exécution | Noyau commun, deux transports (SSH self-hosted / agent serverless) |
| Comptage | ROM par ROM, brut. Filtres région et catégorie en tant que **vue** |
| Stockage catalogue | DAT en fichier (cache disque ou object storage), jamais en base |
| Couverture | No-Intro + Redump, CHD inclus |
| CHD | Match par nom + lecture d'en-tête ; deep verify à la demande sur un titre |
| Déclenchement | Manuel, incrémental, via file de commandes en serverless |

## Sources de données

Toutes vérifiées le 2026-07-25, version `2026.05.02`.

### DAT — `libretro/libretro-database`

```text
metadat/no-intro/{Système}.dat     cartouches   CRC32 + MD5 + SHA1
metadat/redump/{Système}.dat       CD           idem + champ serial
metadat/mame/, metadat/fbneo-split/  arcade
metadat/hacks/, metadat/homebrew/    classification uniquement, hors comptage
```

Format clrmamepro. Exemple No-Intro :

```text
game (
	name "2020 Super Baseball (Japan)"
	region "Japan"
	rom ( name "2020 Super Baseball (Japan).sfc" size 1572864
	      crc E95A3DD7 md5 C9027B03A719A547CB2D9BCF9A9A6CBB
	      sha1 FE448AE2C065DFF8B0C2AACC35F9D9EE9432B04F )
)
```

Gratuit, sans authentification, sans quota. Un fetch par système.

Le champ `serial` des DAT Redump est affiché mais **n'est pas** utilisé pour le
matching : lire le serial d'un disque impose de décompresser le début de l'image
et de parcourir l'ISO9660, ce qui suppose les codecs CHD (LZMA / FLAC / CDZL) —
hors de portée d'un agent Python sans dépendances.

### CSV ScreenScraper

`https://www.screenscraper.fr/medias/{ssConsoleId}/gameslist.csv`

Fichiers statiques, aucun quota API. Fournit `ssGameId` + titre par console.
Rôle secondaire : les systèmes sans DAT exploitable (micros surtout), et le lien
vers les fiches super-retrogamers via le `sr_cache` existant.

Le même mécanisme est déjà en place dans le repo super-retrogamers
(`scripts/download-screenscraper-csvs.ts`).

### Pourquoi pas l'API ScreenScraper pour les hashes

`jeuInfos.php` accepte et retourne bien `crc` / `md5` / `sha1`, mais au rythme
d'un appel par jeu. Sur une collection multi-consoles cela représente des dizaines
de milliers d'appels étalés sur des semaines, contre la limite journalière du
compte. Les DAT fournissent la même information — toutes régions et variantes
comprises — en un fetch par système.

## Architecture

### Modules

| Module | Rôle | Dépend de |
|---|---|---|
| `lib/rom-audit/scan-script.ts` | Génère le script Python de scan on-box | — |
| `lib/rom-audit/manifest.ts` | Types + parsing/validation du manifeste | — |
| `lib/rom-audit/dat-parser.ts` | Parse clrmamepro → entrées typées (streaming) | — |
| `lib/rom-audit/catalog.ts` | Fetch + cache des DAT et CSV | `dat-parser`, `lib/storage` |
| `lib/rom-audit/match.ts` | Croise manifeste × catalogue → `AuditResult` | `manifest`, `catalog` |

`match.ts` est une **fonction pure** : `(manifest, catalog, options) → AuditResult`.
Aucun I/O. Toute la logique délicate y est isolée et testable sans box ni réseau.

### Scan on-box

Un script Python unique, exécuté via `ssh.exec` en self-hosted et par `agent.py`
en serverless. RecalboxOS embarque Python 3 — déjà le prérequis de l'agent
existant.

Sortie : un manifeste JSON, une ligne par fichier.

```json
{ "path": "/recalbox/share/roms/snes/Zelda.zip", "size": 1048576,
  "mtime": 1721900000, "crc32": "E95A3DD7", "kind": "zip-entry",
  "innerName": "Zelda - A Link to the Past (Europe).sfc" }
```

Trois stratégies de hash, par coût croissant :

1. **Zip** — CRC32 lu dans l'en-tête central via `zipfile.ZipFile.infolist()`.
   Aucune décompression, aucune lecture du contenu. Cas majoritaire sur Recalbox.
   Les DAT No-Intro hashent la ROM décompressée : le match est direct.
2. **CHD** — 124 octets d'en-tête. Offsets vérifiés dans les sources de
   [libchdr](https://github.com/rtissera/libchdr) (`src/libchdr_chd.c`) :

   | Version | `sha1` | `rawsha1` | `parentsha1` |
   |---|---|---|---|
   | v5 | 84 | 64 | 104 |
   | v4 | 48 | 88 | 68 |
   | v3 | 80 | — | 100 |

   `rawsha1` est le SHA1 du flux décompressé, donc **déterministe** : deux
   conversions du même disque par des versions différentes de chdman produisent
   le même `rawsha1`. Stocké pour la déduplication et la détection de corruption.
3. **Fichier nu** (`.sfc`, `.md`, `.7z`…) — lecture complète, `zlib.crc32` en
   streaming. Seul cas coûteux. Le 7z n'expose pas de CRC exploitable simplement
   et tombe ici.

### Découverte des supports — correction d'un défaut existant

`lib/recalbox/systems.ts:26` ne scanne que `/recalbox/share/externals/usb*` :
**la carte SD est ignorée**. Le scan énumérera les supports via
`lib/recalbox/storage.ts`, qui expose déjà le tag `recalbox: 'share'` de l'API
Web Manager, au lieu de coder les chemins en dur.

Il listera également les dossiers `/roms` **sans** `gamelist.xml`. Un dossier
rempli mais jamais scrapé doit apparaître dans l'audit : c'est précisément un cas
intéressant, que `listSystems()` masque aujourd'hui.

### Incrémentalité

Le manifeste précédent sert de cache, clé `(path, size, mtime)`. Fichier inchangé
→ hash réutilisé. Sans effet sur les zip et les CHD, qui sont déjà gratuits ;
l'économie porte sur les fichiers nus, qui sont justement les coûteux.

## Mapping système

`SYSTEM_META` (`lib/recalbox/system-meta.ts`, 76 entrées) est étendu de trois
champs optionnels :

```ts
datSource?: 'no-intro' | 'redump' | 'mame'
datFile?: string        // nom exact du fichier dans libretro-database
ssConsoleId?: number
```

Absence de valeur = inventaire seul, sans catalogue. C'est un état valide et
attendu pour une partie des 76 systèmes.

## Cache des catalogues

Les DAT ne vont **pas** en base. Cache disque en self-hosted, object storage via
`lib/storage` en serverless, derrière une interface unique.

Rafraîchissement hebdomadaire conditionné par l'ETag GitHub — un 304 ne coûte
rien. Parsing en streaming ligne à ligne : un DAT MAME dépasse largement le Mo et
ne doit pas être chargé d'un bloc.

## Matching

Trois niveaux de confiance, explicites dans l'UI :

| Niveau | Méthode | Badge |
|---|---|---|
| `verified` | CRC32 (ou MD5/SHA1) identique à une entrée DAT | ✅ vérifié |
| `named` | Nom normalisé identique au nom canonique DAT | ~ identifié par nom |
| `unknown` | Aucune correspondance | ? inconnu |

Les cartouches zippées atteignent `verified` pour un coût de scan nul. Les CHD
atteignent `named` : les DAT Redump hashent les pistes `.bin` individuelles alors
qu'un CHD les fusionne, donc aucun raccourci par hash n'existe. C'est confirmé
par [verifydump](https://github.com/j68k/verifydump), qui décompresse
intégralement (`chdman extractcd` → `binmerge` → comparaison), et par la
discussion équivalente côté [RomM](https://github.com/rommapp/romm/issues/2241).

`unknown` n'est pas un échec : hacks, traductions et mauvais dumps s'y trouvent,
et c'est une information en soi.

### Comptage

**Brut, ROM par ROM.** Dénominateur = nombre d'entrées ROM du DAT. Numérateur =
nombre d'entrées matchées.

Par-dessus, des **filtres de vue** dérivés des tags de nomenclature No-Intro —
`(Proto)`, `(Beta)`, `(Demo)`, `(Sample)`, `(Pirate)`, `(Unl)`, `(Aftermarket)`,
`[b]`, `(Rev X)`, `(Alt)`, région — qui restreignent l'affichage **sans** changer
la métrique de base.

Conséquence assumée : un DAT SNES contient ~4000 entrées là où le catalogue des
jeux commerciaux en fait ~1700. Une collection US complète affichera donc un
pourcentage bas. C'est un choix délibéré de collectionneur ; les filtres servent à
naviguer dans le détail.

## Persistance

Deux tables. C'est ce qui tient la promesse de ne pas gonfler Turso.

```text
rom_files
  id, recalbox_id, mount, system, path, size, mtime,
  crc32, sha1, kind, inner_name,
  match_level ('verified' | 'named' | 'unknown'),
  dat_entry_name, scanned_at
  index (recalbox_id, system)
  index (recalbox_id, crc32)

rom_scans
  id, recalbox_id, status, started_at, completed_at, error,
  stats_json   -- agrégats par système : total DAT, matchés, inconnus
```

**La liste des manquants n'est jamais stockée.** À l'ouverture du détail d'un
système, on charge ce DAT depuis le cache, on soustrait l'ensemble matché (une
requête sur `rom_files` filtrée par système), et on rend. Un système à la fois :
mémoire bornée, zéro écriture.

`rom_files` est dimensionné par la collection de l'utilisateur — quelques dizaines
de milliers de lignes au pire — jamais par le catalogue.

## Transports

Route d'entrée commune : `POST /api/rom-audit/scan`.

**Self-hosted** — tâche de fond côté serveur via `SshPool`. Écriture de
`rom_files` par lots au fil de l'eau, progression poussée en SSE.

**Serverless** — insertion d'une ligne `agent_commands` de type `scan`.
L'allowlist actuelle vaut `'power' | 'launch' | 'conf'`
(`lib/db/schema.ts:586`) et doit être étendue. L'agent récupère la commande via
son polling existant, exécute le scan, puis POSTe le manifeste sur une nouvelle
route `/api/agent/rom-scan`, **chunkée** comme l'est déjà `/api/agent/collection`.

Le manifeste ne passe **pas** par le champ `result` d'`agent_commands` : c'est du
texte libre destiné à un message d'erreur.

Dans les deux cas la progression remonte par le SSE existant, donc l'UI est
identique.

## UI

Sous-route `/[locale]/collection/audit`, à côté de la page collection existante.

- **Vue d'ensemble** — une carte par système : taux brut, répartition
  vérifié / identifié / inconnu, support physique.
- **Détail d'un système** — trois listes (possédés, manquants, inconnus) avec les
  filtres région et catégorie.
- **Deep verify** — bouton sur un titre CHD, déclenche une vérification profonde
  de ce seul titre.

Pas de fusion avec `lib/collection-health.ts`. Celui-ci répond à une autre
question — « mes jeux sont-ils bien scrapés » — et travaille sur la table `games`.
Deux préoccupations distinctes, deux modules distincts, présentés comme deux
onglets de la même page.

## Risques et points à trancher à l'implémentation

**Disponibilité de `chdman` sur la box.** Le deep verify d'un titre CHD suppose
`chdman extractcd` puis `binmerge`. RecalboxOS embarque MAME, mais la présence du
binaire `chdman` dans le PATH n'est **pas vérifiée** à ce stade. Première action
de l'implémentation : la tester sur une box réelle. En cas d'absence, le bouton
deep verify est masqué et l'audit CHD s'en tient au niveau `named` — ce qui reste
un lot livrable, puisque le deep verify n'est qu'un complément à la demande.

**Espace temporaire pour le deep verify.** Une extraction CHD produit un
temporaire de la taille du disque décompressé (jusqu'à ~700 Mo pour un CD, plus
pour un DVD). Vérifier l'espace libre du support via `storage.ts` avant de lancer,
et refuser proprement si insuffisant.

**Association fichier → support physique.** `storage.ts` liste les points de
montage, mais rattacher un chemin de ROM au bon support demande de résoudre le
préfixe de montage le plus long. Cas limite à couvrir par un test.

**Systèmes à nomenclature divergente.** Les dossiers Recalbox (`snes`,
`megadrive`) ne correspondent pas aux noms de fichiers DAT
(`Nintendo - Super Nintendo Entertainment System.dat`). Le mapping est une saisie
manuelle de ~76 entrées ; les entrées non renseignées dégradent proprement vers
« inventaire seul ».

## Tests

`match.ts` étant pur, il porte l'essentiel de la couverture : fixtures DAT
réduites, nomenclatures tordues, collisions de CRC, multi-disques.

`dat-parser.ts` se teste sur des extraits réels des trois formats (No-Intro,
Redump, MAME).

Le script de scan se teste sur une arborescence temporaire contenant un vrai zip
et un en-tête CHD forgé, pour chacune des versions v3 / v4 / v5.

Aucun de ces tests ne requiert une Recalbox.
