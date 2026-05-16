# Design : Intégration Super Retrogamers (Ticket 10)

**Date** : 2026-05-16
**Statut** : Approuvé

## Contexte

Pont entre le dashboard Recalbox et l'encyclopédie [super-retrogamers.com](https://super-retrogamers.com). Depuis le dashboard, chaque jeu peut afficher sa fiche encyclopédique SR.

Deux phases :
- **Phase 1 (ce ticket)** : infrastructure complète côté dashboard, client en mode mock (`{ exists: false }` hardcodé). UI en place mais inopérante.
- **Phase 2 (après)** : implémentation de l'API SR selon la spec, puis activation.

## Format URL Super Retrogamers

Extrait de la base de données SR locale :

```
https://www.super-retrogamers.com/games/{game-slug}?region={region}
```

Où `{game-slug}` = `{nom-normalisé}-console-{console-slug}`.

Exemples réels (avant correction du bug de duplication dans SR) :
- `super-mario-world-console-super-nintendo`
- `legend-of-zelda-a-link-to-the-past-the-console-super-nintendo`
- `007-agent-under-fire-console-playstation-2`

Le paramètre `?region` contrôle la langue/région d'affichage de la fiche.

---

## Section 1 : Module `lib/super-retrogamers/`

### Structure

```
lib/super-retrogamers/
├── slug.ts        — gameToSlug() + SR_SYSTEM_SLUGS
├── client.ts      — SuperRetrogamersClient (mock Phase 1)
├── cache.ts       — lecture/écriture sr_cache
├── region.ts      — détection région ROM + fallback préférence user
└── __tests__/
    ├── slug.test.ts
    └── client.test.ts
```

### Algorithme `gameToSlug(name, system)`

Étapes dans l'ordre :
1. Strip extension fichier ROM (`.smc`, `.bin`, `.cue`, etc.)
2. Strip tags région : `(USA)`, `(Europe)`, `(Japan)`, `(World)`, `(E)`, `(U)`, `(J)`, `(UE)`, `(JU)`, etc.
3. Strip tags version : `[!]`, `(v1.0)`, `(Rev A)`, `(Beta)`, `(Proto)`, `(Disc 1)`, `(Track 01)`, etc.
4. Normalise accents → ASCII (é→e, ü→u, ñ→n, etc.)
5. Lowercase
6. Retire apostrophes, deux-points, points, virgules
7. Hyphens existants + underscores → espace
8. Espaces multiples → tiret simple
9. Trim tirets en début/fin
10. **Variante "The"** : si slug commence par `the-`, génère aussi `{reste}-the` comme slug secondaire à essayer en fallback

Retourne le slug complet : `{nom-normalisé}-console-{console-slug}`

### Mapping `SR_SYSTEM_SLUGS`

Extrait de la base PostgreSQL SR (`consoles.slug`) :

| Recalbox | SR console slug |
|----------|----------------|
| `snes` | `super-nintendo` |
| `nes` | `nes` |
| `megadrive` | `megadrive` |
| `gb` | `game-boy` |
| `gbc` | `game-boy-color` |
| `gba` | `game-boy-advance` |
| `psx` | `playstation` |
| `ps2` | `playstation-2` |
| `ps3` | `playstation-3` |
| `psp` | `psp` |
| `gc` | `gamecube` |
| `n64` | `nintendo-64` |
| `nds` | `nintendo-ds` |
| `wii` | `wii` |
| `dreamcast` | `dreamcast` |
| `saturn` | `saturn` |
| `segacd` | `mega-cd` |
| `megadrive32x` | `megadrive-32x` |
| `gamegear` | `game-gear` |
| `mastersystem` | `master-system` |
| `neogeo` | `neo-geo` |
| `neogeocd` | `neo-geo-cd` |
| `neogeopocket` | `neo-geo-pocket` |
| `neogeopocketcolor` | `neo-geo-pocket-color` |
| `atari2600` | `atari-2600` |
| `atari5200` | `atari-5200` |
| `atari7800` | `atari-7800` |
| `lynx` | `lynx` |
| `jaguar` | `jaguar` |
| `jaguarcd` | `jaguar-cd` |
| `msx` | `msx` |
| `msx2` | `msx2` |
| `pcengine` | `pc-engine` |
| `pcenginecd` | `pc-engine-cd-rom` |
| `supergrafx` | `pc-engine-supergrafx` |
| `pcfx` | `pc-fx` |
| `fds` | `family-computer-disk-system` |
| `virtualboy` | `virtual-boy` |
| `wonderswan` | `wonderswan` |
| `wonderswancolor` | `wonderswan-color` |
| `xbox` | `xbox` |
| `xbox360` | `xbox-360` |
| `3do` | `3do` |
| `intellivision` | `intellivision` |
| `colecovision` | `colecovision` |
| `vectrex` | `vectrex` |
| `channelf` | `channel-f` |
| `amigacd32` | `amiga-cd32` |
| `amigacdtv` | `amiga-cdtv` |
| `gx4000` | `gx4000` |
| `msx-turbo-r` | `msx-turbo-r` |

Systèmes sans correspondance SR (mame, fbneo, scummvm, dosbox, etc.) → `gameToSlug()` retourne `null`.

### Détection région (`region.ts`)

Priorité :
1. Tag région dans le nom du ROM : `(USA)` → `US`, `(Europe)` → `EU`, `(Japan)` → `JP`, `(World)` → `US` (défaut mondial)
2. Préférence utilisateur `settings.superRetrogamers.preferredRegion`
3. Pas de paramètre `?region` si aucun des deux n'est disponible

---

## Section 2 : Base de données

### Extensions table `games`

Migration Drizzle :
```sql
ALTER TABLE games ADD COLUMN sr_slug TEXT;
ALTER TABLE games ADD COLUMN sr_has_page INTEGER DEFAULT NULL;
ALTER TABLE games ADD COLUMN sr_url TEXT;
ALTER TABLE games ADD COLUMN sr_checked_at INTEGER;
```

`sr_has_page` : `NULL` = jamais vérifié, `0` = pas de fiche, `1` = fiche disponible.

### Nouvelle table `sr_cache`

```typescript
export const srCache = sqliteTable('sr_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
})
```

TTL par préfixe de clé :
- `exists:{slug}` → 24h
- `game:{slug}` → 12h
- `systems` → 7 jours

### Préférence utilisateur

Clé `superRetrogamers.preferredRegion` dans la table `settings` existante (valeurs : `US`, `EU`, `JP`, ou absent = pas de préférence).
Clé `superRetrogamers.enabled` (boolean) pour le feature flag.
Clé `superRetrogamers.apiUrl` (string optionnel) pour l'override d'URL API.

---

## Section 3 : Composants UI

### `<SuperRetrogamersLink>`

```typescript
type Props = {
  romPath: string
  gameName: string
  system: string
  srHasPage: boolean | null
  srUrl: string | null
  variant?: 'button' | 'icon' | 'badge'
}
```

Comportement par état :
- `srHasPage === true` → lien cliquable vers `srUrl` (target `_blank`)
- `srHasPage === false` → désactivé + tooltip "Pas de fiche sur Super Retrogamers"
- `srHasPage === null` → bouton "Vérifier" qui POST `/api/super-retrogamers/lookup`

### Badge dans `<GameCard>`

Choix validé : **chip dans la rangée méta** (variante B), cohérent avec les chips région/genre existants.

```tsx
{game.srHasPage && (
  <span className="sr-chip">SR ✓</span>
)}
```

Couleur : violet (`#7c3aed` / `violet-700`), fond translucide, bordure légère. Affiché uniquement si `sr_has_page = true`.

### `<SuperRetrogamersPreview>`

Composant client dans la modal jeu, onglet "Super Retrogamers".

États :
- `loading` — skeleton
- `not-found` — "Pas de fiche sur Super Retrogamers" + lien de recherche
- `error` — "Impossible de charger la fiche" + bouton retry
- `loaded` — verdict (score + résumé), specs techniques, personnages, CTA "Lire l'article complet ↗"

Fetch uniquement via `/api/super-retrogamers/games/[slug]` (jamais direct depuis le browser).

### Intégrations dans les pages existantes

| Page | Intégration |
|------|-------------|
| Collection grid (`<GameCard>`) | Chip `SR ✓` dans la rangée méta |
| Modal jeu | Onglet "Super Retrogamers" avec `<SuperRetrogamersPreview>` |
| Stats > TopGames | Icône SR (variante `icon`) sous chaque entrée |
| Now Playing | Bouton variante `icon` si `srHasPage === true` |

---

## Section 4 : Routes API (proxy Next.js)

Toutes les routes sont dans `app/api/super-retrogamers/`.

### `GET /api/super-retrogamers/games/[slug]`

1. Vérifie `sr_cache` — clé `game:{slug}`
2. Hit non expiré → retourne le cache
3. Miss → fetch SR API → store cache (TTL 12h) → retourne
4. SR down → retourne cache même expiré + `{ stale: true }`
5. SR down + cache vide → retourne `null` (le composant affiche l'état `error`)

### `POST /api/super-retrogamers/lookup`

Body : `{ slugs: string[] }` (max 100)

1. Filtre les slugs déjà en cache `exists:{slug}`
2. Bulk check existence via `SuperRetrogamersClient.bulkLookup()`
3. Met à jour `sr_has_page` / `sr_url` / `sr_checked_at` dans `games`
4. Met en cache `exists:{slug}` (TTL 24h)
5. Retourne `{ results: Record<string, { exists: boolean, url?: string }> }`

### `POST /api/super-retrogamers/enrich-collection`

Stream NDJSON (même pattern que `/api/collection/sync`).

1. Sélectionne les jeux sans `sr_checked_at` (idempotent)
2. Génère les slugs SR via `gameToSlug()`
3. Batch de 100 → POST `/api/super-retrogamers/lookup`
4. Émet `{ type: 'progress', done: N, total: N }` à chaque batch
5. Émet `{ type: 'complete', matched: N, total: N }` à la fin

### `POST /api/super-retrogamers/test-connection`

1. Appelle `SuperRetrogamersClient.listSystems()`
2. Mesure la latence
3. Retourne `{ ok: boolean, latencyMs?: number, error?: string }`

---

## Section 5 : Settings tab "Intégrations"

5ème onglet dans `/settings`, après "RetroAchievements".

Contenu :
- **Toggle** "Activer l'intégration Super Retrogamers" → `settings.superRetrogamers.enabled`
- **Région préférée** : select `US / EU / JP` (vide = pas de préférence)
- **URL API** (optionnel) : input text, placeholder `https://super-retrogamers.com/api/v1`
- **Bouton "Tester la connexion"** → POST `/api/super-retrogamers/test-connection`, affiche latence ou message d'erreur
- **Bouton "Enrichir la collection"** → POST `/api/super-retrogamers/enrich-collection`, progress bar temps réel
- **Stats** : `"X jeux dans la collection · Y référencés sur Super Retrogamers"`

Si `enabled = false` → aucun composant SR ne s'affiche dans l'interface. Feature flag propre.

---

## Spec API SR (à implémenter côté super-retrogamers.com)

Voir `docs/super-retrogamers-api-spec.md` (créé dans ce ticket).

Endpoints requis :
- `GET /api/v1/games/exists?slug=` — check existence léger
- `GET /api/v1/games/:slug` — données complètes
- `POST /api/v1/games/lookup` — bulk lookup (max 100 slugs)
- `GET /api/v1/systems` — liste des systèmes couverts

CORS `*` requis. Cache-Control sur les réponses.

---

## Tests

### `slug.test.ts` (20+ cas)

- Cas nominaux : `Super Mario World (USA).smc` → `super-mario-world-console-super-nintendo`
- Article "The" : `The Legend of Zelda - A Link to the Past (USA).smc` → primaire + variante `-the`
- Accents : `Phalanx - The Enforce Fighter A-144 (Europe).smc` → pas de caractères spéciaux
- Tags complexes : `Castlevania - Symphony of the Night (USA) [!].bin` → strip `[!]`
- Chiffres romains : pas de conversion (slug exact SR requis)
- Système sans mapping (mame) → `null`
- Apostrophes : `Yoshi's Island` → `yoshis-island`

### `client.test.ts`

- Mock fetch : success, 404, 500, timeout, network error
- Retry logic (1 retry, backoff 500ms)
- Graceful degradation → `null`/`false` jamais d'exception propagée

---

## Traductions

Section `superRetrogamers` dans `en.json` et `fr.json` :
- Labels settings, tooltips, états du composant preview, messages d'erreur

---

## Contraintes

- Intégration désactivable sans casser le reste (`enabled` flag)
- Si SR API down → aucune page ne ralentit ni ne plante (timeout 5s, catch global)
- Aucun appel SR direct depuis le browser (toujours via proxy Next.js)
- Slug deterministe et idempotent
- Strict TypeScript
